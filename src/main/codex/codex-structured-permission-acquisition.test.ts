import { describe, expect, it } from 'vitest'
import { codexPermissionPolicy } from '../../shared/codex-permissions'
import { readNativeSessionOptions } from '../native-chat/agent-session-wire/structured-agent-session-option-restoration'
import { CodexAppServerRequestError } from './codex-app-server-connection'
import {
  adapterFor,
  fakeCodex,
  identityFor,
  THREAD_ID,
  USER_MESSAGE
} from './codex-structured-session-adapter-fixture'

const saved = {
  model: 'gpt-live',
  permissions: 'full-access',
  permissionState: JSON.stringify(codexPermissionPolicy('full-access'))
}
const acquire = {
  identity: identityFor('session-1'),
  fence: 7,
  spawnToken: 'spawn-1',
  options: saved
}
const live = { sessionId: 'session-1', fence: 7 }

function fixture(
  requirements: unknown = {
    allowedApprovalPolicies: ['on-request'],
    allowedSandboxModes: ['workspace-write']
  }
) {
  const codex = fakeCodex({
    'configRequirements/read': () => ({ requirements }),
    'model/list': () => ({
      data: [
        {
          id: 'gpt-live',
          model: 'gpt-live',
          displayName: 'Live',
          isDefault: true,
          supportedReasoningEfforts: []
        }
      ],
      nextCursor: null
    }),
    'thread/resume': (params) => ({
      thread: { id: THREAD_ID },
      model: 'gpt-live',
      ...codexPermissionPolicy(
        params?.sandbox === 'danger-full-access'
          ? 'full-access'
          : params?.approvalsReviewer === 'auto_review'
            ? 'approve-for-me'
            : 'ask-for-approval'
      )
    }),
    'turn/start': () => ({ turn: { id: 'turn-1' } })
  })
  return { codex, adapter: adapterFor(codex, { resumeThreadId: THREAD_ID }) }
}

describe('structured permission acquisition recovery', () => {
  it('never applies a new-thread default to a resumed thread without saved permissions', async () => {
    const { codex } = fixture(null)
    const adapter = adapterFor(codex, {
      resumeThreadId: THREAD_ID,
      initialPermissions: codexPermissionPolicy('full-access')
    })
    await adapter.acquire({ ...acquire, options: {} })
    const request = codex.connections[0]!.calls.find(({ method }) => method === 'thread/resume')!
    expect(request.params).not.toHaveProperty('approvalPolicy')
    expect(request.params).not.toHaveProperty('sandbox')
  })

  it('requires confirmation of a host-restricted initial fallback', async () => {
    const { codex } = fixture()
    codex.routes['thread/start'] = () => ({
      thread: { id: THREAD_ID },
      ...codexPermissionPolicy('full-access')
    })
    const adapter = adapterFor(codex, { initialPermissions: codexPermissionPolicy('full-access') })
    await expect(adapter.acquire({ ...acquire, options: {} })).rejects.toThrow('did not confirm')
    expect(codex.connections[0]!.closeCount).toBe(1)
  })

  it('refuses an initial default when the host allows no fallback preset', async () => {
    const { codex } = fixture({ allowedSandboxModes: ['read-only'] })
    const adapter = adapterFor(codex, { initialPermissions: codexPermissionPolicy('full-access') })
    await expect(adapter.acquire({ ...acquire, options: {} })).rejects.toThrow(
      'No permitted permission preset'
    )
    expect(codex.connections[0]!.calls.some(({ method }) => method === 'thread/start')).toBe(false)
  })

  it('reopens once under allowed permissions, retains durable intent, and keeps send and clear usable', async () => {
    const { adapter, codex } = fixture()
    await adapter.acquire(acquire)
    const connection = codex.connections[0]!
    expect(connection.calls.filter(({ method }) => method === 'thread/resume')).toEqual([
      {
        method: 'thread/resume',
        params: expect.objectContaining({
          sandbox: 'workspace-write',
          approvalPolicy: 'on-request'
        })
      }
    ])
    expect((await adapter.readOptions(live)).permissions).toMatchObject({
      current: 'ask-for-approval',
      desired: 'full-access',
      restoration: 'failed'
    })
    expect((await adapter.readOptions(live)).permissions?.pending).toBeUndefined()
    const durable = await readNativeSessionOptions({ adapter, ...live, priorOptions: saved })
    expect(durable).toMatchObject({
      permissions: 'full-access',
      permissionState: JSON.stringify(codexPermissionPolicy('ask-for-approval'))
    })
    expect(JSON.parse(durable!.permissionRecovery!)).toEqual({
      desired: 'full-access',
      effective: codexPermissionPolicy('ask-for-approval')
    })
    await adapter.dispatch({ ...live, clientMessageId: 'message-1', body: USER_MESSAGE })
    expect(connection.calls.find(({ method }) => method === 'turn/start')?.params).toMatchObject(
      codexPermissionPolicy('ask-for-approval')
    )
    const cleared = fixture()
    cleared.codex.routes['thread/start'] = cleared.codex.routes['thread/resume']!
    const replacement = adapterFor(cleared.codex)
    await replacement.acquire({ ...acquire, identity: identityFor('cleared'), options: durable })
    expect(
      cleared.codex.connections[0]!.calls.find(({ method }) => method === 'thread/start')?.params
    ).toMatchObject({ sandbox: 'workspace-write' })
    const restarted = fixture()
    await restarted.adapter.acquire({ ...acquire, options: durable })
    expect((await restarted.adapter.readOptions(live)).permissions).toMatchObject({
      desired: 'full-access',
      restoration: 'failed'
    })
    expect(saved.permissions).toBe('full-access')
  })

  it('keeps failure through a stale report and failed retry, then rearms after a real requirements read', async () => {
    const { adapter, codex } = fixture()
    await adapter.acquire(acquire)
    codex.connections[0]!.handlers.onNotification?.('thread/settings/updated', {
      threadId: THREAD_ID,
      threadSettings: codexPermissionPolicy('full-access')
    })
    await expect(
      adapter.setOption({ ...live, key: 'permissions', value: 'full-access' })
    ).rejects.toThrow('restricted')
    expect((await adapter.readOptions(live)).permissions?.restoration).toBe('failed')
    expect((await adapter.readOptions(live)).permissions?.current).toBe('ask-for-approval')
    await adapter.dispatch({ ...live, clientMessageId: 'message-1', body: USER_MESSAGE })
    expect(
      codex.connections[0]!.calls.find(({ method }) => method === 'turn/start')?.params
    ).toMatchObject(codexPermissionPolicy('ask-for-approval'))
    codex.routes['configRequirements/read'] = () => ({ requirements: null })
    const options = await adapter.setOption({ ...live, key: 'permissions', value: 'full-access' })
    expect(options).not.toHaveProperty('permissionRecovery')
    await adapter.dispatch({ ...live, clientMessageId: 'message-2', body: USER_MESSAGE })
    expect(
      codex.connections[0]!.calls.findLast(({ method }) => method === 'turn/start')?.params
    ).toMatchObject(codexPermissionPolicy('full-access'))
  })

  it('uses mandatory automatic review when it is the only permitted non-escalating preset', async () => {
    const { adapter, codex } = fixture({
      allowedApprovalPolicies: ['on-request'],
      allowedSandboxModes: ['workspace-write'],
      autoReview: { requiredOnModels: ['gpt-live'] }
    })
    await adapter.acquire(acquire)
    expect(
      codex.connections[0]!.calls.find(({ method }) => method === 'thread/resume')?.params
    ).toMatchObject({ approvalsReviewer: 'auto_review' })
    expect((await adapter.readOptions(live)).permissions).toMatchObject({
      desired: 'full-access',
      current: 'approve-for-me',
      restoration: 'failed'
    })
  })

  it('revalidates a persisted fallback without retrying the previously refused desired mode', async () => {
    const { adapter, codex } = fixture({
      allowedApprovalPolicies: ['on-request'],
      allowedSandboxModes: ['workspace-write'],
      allowedPermissionProfiles: { ':workspace': true },
      autoReview: { requiredOnModels: ['gpt-live'] }
    })
    await adapter.acquire({
      ...acquire,
      options: {
        ...saved,
        permissionRecovery: JSON.stringify({
          desired: 'full-access',
          effective: codexPermissionPolicy('ask-for-approval')
        })
      }
    })
    expect(codex.connections[0]!.calls.filter(({ method }) => method === 'thread/resume')).toEqual([
      {
        method: 'thread/resume',
        params: expect.objectContaining({
          sandbox: 'workspace-write',
          approvalsReviewer: 'auto_review'
        })
      }
    ])
    expect((await adapter.readOptions(live)).permissions).toMatchObject({
      desired: 'full-access',
      current: 'approve-for-me',
      restoration: 'failed'
    })
  })

  it.each([
    new Error('transport unavailable'),
    new CodexAppServerRequestError(
      'thread/resume',
      -32602,
      'invalid params unrelated to permissions'
    )
  ])('never repeats an ambiguous or unrelated failed acquisition: %s', async (error) => {
    const { adapter, codex } = fixture(null)
    codex.routes['thread/resume'] = () => {
      throw error
    }
    await expect(adapter.acquire(acquire)).rejects.toThrow(error.message)
    expect(
      codex.connections[0]!.calls.filter(({ method }) => method === 'thread/resume')
    ).toHaveLength(1)
    expect(codex.connections[0]!.closeCount).toBe(1)
  })

  it('does not invent a fallback when requirements are unavailable', async () => {
    const { adapter, codex } = fixture()
    codex.routes['configRequirements/read'] = () => {
      throw new Error('requirements unavailable')
    }
    await adapter.acquire(acquire)
    expect(
      codex.connections[0]!.calls.find(({ method }) => method === 'thread/resume')?.params
    ).toMatchObject({ sandbox: 'danger-full-access' })
    expect((await adapter.readOptions(live)).permissions?.restoration).toBeUndefined()
  })

  it('refuses an unconfirmed fallback without reviving the saved unrestricted policy', async () => {
    const { adapter, codex } = fixture()
    codex.routes['thread/resume'] = () => ({ thread: { id: THREAD_ID }, model: 'gpt-live' })
    await expect(adapter.acquire(acquire)).rejects.toThrow('did not confirm')
    expect(codex.connections[0]!.closeCount).toBe(1)
    expect(
      codex.connections[0]!.calls.filter(({ method }) => method === 'thread/resume')
    ).toHaveLength(1)
  })
})
