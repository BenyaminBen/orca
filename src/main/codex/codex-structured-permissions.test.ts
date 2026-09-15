import { describe, expect, it, vi } from 'vitest'
import type { CodexSession } from './codex-structured-session-state'
import { CodexAcquisitionWindow } from './codex-structured-acquisition-window'
import { CodexBackgroundTaskTracker } from './codex-background-task-tracker'
import { codexPermissionPolicy } from '../../shared/codex-permissions'
import {
  observeCodexPermissions,
  readCodexPermissionOptions,
  selectCodexPermissions,
  selectedCodexPermissionPolicy
} from './codex-structured-permissions'
import { startCodexTurn } from './codex-structured-turn-start'
import { readNativeSessionOptions } from '../native-chat/agent-session-wire/structured-agent-session-option-restoration'
import { openCodexThread } from './codex-structured-thread-open'

function sessionFixture(requirements: unknown = null) {
  const request = vi.fn(async (method: string, _params?: Record<string, unknown>) =>
    method === 'configRequirements/read' ? { requirements } : { turn: { id: 'turn-1' } }
  )
  const session: CodexSession = {
    connection: {
      pid: 1,
      closed: false,
      request,
      notify: () => {},
      respond: () => {},
      respondWithError: () => {},
      close: async () => true
    },
    backgroundTasks: new CodexBackgroundTaskTracker('thread-1'),
    ended: false,
    requestedClose: false,
    fence: 1,
    acquisitionGeneration: 'generation-1',
    threadId: 'thread-1',
    historyPath: null,
    prompts: new CodexAcquisitionWindow().prompts,
    options: new Map(),
    reportedOptions: { model: 'model', permissions: codexPermissionPolicy('ask-for-approval') },
    fastModeTierByModel: new Map(),
    turnIdWaiters: [],
    translator: null,
    activeTurnIds: new Set()
  }
  return { session, request }
}

describe('structured conversation permissions', () => {
  it('sends one atomic policy on the next turn and awaits a matching provider report', async () => {
    const { session, request } = sessionFixture()
    const other = sessionFixture().session
    await selectCodexPermissions(session, 'full-access')
    expect(await readCodexPermissionOptions(session)).toMatchObject({
      current: 'ask-for-approval',
      pending: 'full-access'
    })
    expect(other.options.size).toBe(0)
    await startCodexTurn(session, {
      clientMessageId: 'message',
      body: { kind: 'message', role: 'user', blocks: [{ type: 'text', text: 'test' }] }
    })
    expect(request.mock.calls.find(([method]) => method === 'turn/start')?.[1]).toMatchObject({
      approvalPolicy: 'never',
      approvalsReviewer: 'user',
      sandboxPolicy: { type: 'dangerFullAccess' }
    })
    observeCodexPermissions(session, {
      threadId: 'another-thread',
      threadSettings: codexPermissionPolicy('full-access')
    })
    expect(session.options.get('permissions')).toBe('full-access')
    observeCodexPermissions(session, {
      threadId: session.threadId,
      threadSettings: codexPermissionPolicy('full-access')
    })
    expect(await readCodexPermissionOptions(session)).toMatchObject({ current: 'full-access' })
    expect((await readCodexPermissionOptions(session)).pending).toBeUndefined()
    expect(session.options.get('permissions')).toBe('full-access')
  })

  it('retains the old state after a refused mutation and disables restricted modes', async () => {
    const { session } = sessionFixture({
      allowedApprovalPolicies: ['on-request'],
      allowedSandboxModes: ['workspace-write']
    })
    await expect(selectCodexPermissions(session, 'full-access')).rejects.toThrow('restricted')
    expect(session.options.has('permissions')).toBe(false)
    expect((await readCodexPermissionOptions(session)).choices[2]?.disabledReason).toContain(
      'restricted'
    )
  })

  it('locks permissions while a turn or dispatch is active', async () => {
    const { session } = sessionFixture()
    session.activeTurnIds?.add('turn')
    await expect(selectCodexPermissions(session, 'full-access')).rejects.toThrow('current turn')
    session.activeTurnIds?.clear()
    session.dispatchPending = true
    await expect(selectCodexPermissions(session, 'full-access')).rejects.toThrow('current turn')
  })

  it('keeps unknown capabilities visible and never labels unknown state Custom', async () => {
    const { session } = sessionFixture()
    session.reportedOptions.permissions = undefined
    session.connection.request = async () => {
      throw new Error('connection lost')
    }
    const result = await readCodexPermissionOptions(session)
    expect(result.current).toBeUndefined()
    expect(result.choices).toHaveLength(3)
    expect(result.choices.every((choice) => choice.disabledReason)).toBe(true)
  })
  it('preserves a pending selection across clear and a temporarily missing report', async () => {
    const priorOptions = {
      permissions: 'approve-for-me',
      permissionState: JSON.stringify(codexPermissionPolicy('full-access'))
    }
    const result = await readNativeSessionOptions({
      adapter: {
        readOptions: async () => ({
          models: [],
          current: { model: 'model' },
          permissions: { choices: [] }
        })
      },
      sessionId: 'session',
      fence: 1,
      priorOptions
    })
    expect(result).toMatchObject(priorOptions)
  })

  it('disables modes that violate mandatory automatic review for the active model', async () => {
    const { session } = sessionFixture({ autoReview: { requiredOnModels: ['model'] } })
    const result = await readCodexPermissionOptions(session)
    expect(
      result.choices.filter(({ disabledReason }) => !disabledReason).map(({ value }) => value)
    ).toEqual(['approve-for-me'])
  })

  it('preserves effective permissions when clearing or handing a conversation over', async () => {
    const policy = codexPermissionPolicy('approve-for-me')
    const options = await readNativeSessionOptions({
      adapter: {
        readOptions: async () => ({
          models: [],
          current: { model: 'model' },
          permissions: { current: 'approve-for-me', policy, choices: [] }
        })
      },
      sessionId: 'session',
      fence: 1,
      priorOptions: {
        permissions: 'full-access',
        approvalPolicy: 'never',
        permissionState: JSON.stringify(codexPermissionPolicy('full-access'))
      }
    })
    expect(options).toEqual({
      model: 'model',
      permissions: 'full-access',
      permissionState: JSON.stringify(policy)
    })
    const request = vi.fn(async () => ({
      thread: { id: 'new-thread' },
      model: 'model',
      ...policy,
      sandbox: policy.sandboxPolicy
    }))
    const opened = await openCodexThread(
      { request },
      { cwd: '/workspace', resumeThreadId: null, permissions: policy },
      undefined
    )
    expect(opened.permissions).toEqual(policy)
    expect(request).toHaveBeenCalledWith(
      'thread/start',
      expect.objectContaining({
        approvalPolicy: 'on-request',
        approvalsReviewer: 'auto_review',
        sandbox: 'workspace-write'
      }),
      { timeoutMs: undefined }
    )
  })

  it('keeps the latest desired policy through delayed reports and failed turns', async () => {
    const { session, request } = sessionFixture()
    await selectCodexPermissions(session, 'full-access')
    observeCodexPermissions(session, {
      threadId: session.threadId,
      threadSettings: codexPermissionPolicy('ask-for-approval')
    })
    expect(selectedCodexPermissionPolicy(session.options)).toEqual(
      codexPermissionPolicy('full-access')
    )
    expect(await readCodexPermissionOptions(session)).toMatchObject({
      current: 'ask-for-approval',
      pending: 'full-access'
    })
    observeCodexPermissions(session, {
      threadId: session.threadId,
      threadSettings: codexPermissionPolicy('full-access')
    })
    await selectCodexPermissions(session, 'approve-for-me')
    observeCodexPermissions(session, {
      threadId: session.threadId,
      threadSettings: codexPermissionPolicy('full-access')
    })
    request.mockRejectedValueOnce(new Error('transport unavailable'))
    const turn = {
      clientMessageId: 'retry',
      body: {
        kind: 'message' as const,
        role: 'user' as const,
        blocks: [{ type: 'text' as const, text: 'fixture' }]
      }
    }
    await expect(startCodexTurn(session, turn)).rejects.toThrow('transport unavailable')
    await startCodexTurn(session, turn)
    expect(request.mock.calls.at(-1)?.[1]).toMatchObject(codexPermissionPolicy('approve-for-me'))
    const options = await readNativeSessionOptions({
      adapter: {
        readOptions: async () => ({
          models: [],
          current: { model: 'model' },
          permissions: await readCodexPermissionOptions(session)
        })
      },
      sessionId: 'session',
      fence: 1,
      priorOptions: Object.fromEntries(session.options)
    })
    expect(options?.permissions).toBe('approve-for-me')
    expect(options?.permissionState).toBe(JSON.stringify(codexPermissionPolicy('full-access')))
  })
})
