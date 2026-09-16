// @vitest-environment happy-dom
import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { useStructuredAgentSession } from './use-structured-agent-session'
import { CODEX_PERMISSION_MODES, codexPermissionPolicy } from '../../../../shared/codex-permissions'

const mocks = vi.hoisted(() => ({ call: vi.fn(), send: vi.fn(), settings: vi.fn() }))
vi.mock('@/runtime/structured-agent-session-client', () => ({
  callStructuredAgentSession: mocks.call
}))
vi.mock('./native-chat-session-option-settings-write', () => ({
  enqueueSessionOptionSettingsWrite: mocks.settings
}))
vi.mock('./use-structured-agent-session-read', () => ({
  useStructuredAgentSessionRead: () => ({
    state: {
      fence: 3,
      items: [],
      submissions: [],
      status: 'ready',
      error: null,
      hasOlder: false,
      handoff: null
    },
    loadingOlder: false,
    loadOlder: vi.fn()
  })
}))
vi.mock('./use-structured-agent-session-outbox', () => ({
  structuredSessionOperationId: () => 'operation-1',
  useStructuredAgentSessionOutbox: () => ({
    outbox: [],
    blockedClientMessageId: null,
    error: null,
    send: mocks.send,
    retry: vi.fn()
  })
}))
afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})
const target = { kind: 'local' } as const

it('performs Retry through the option mutation and enables sending after failure or pending application', async () => {
  let allowed = false
  let retried = false
  mocks.call.mockImplementation(async (_target, method) => {
    if (method === 'agentSession.options') {
      return {
        models: [{ id: 'model', label: 'Model', isDefault: true, efforts: [] }],
        current: { model: 'model' },
        permissions: {
          current: 'ask-for-approval',
          desired: 'full-access',
          policy: codexPermissionPolicy('ask-for-approval'),
          ...(retried ? { pending: 'full-access' } : { restoration: 'failed' }),
          choices: CODEX_PERMISSION_MODES.map(({ value }) => ({
            value,
            ...(value === 'full-access' && !allowed ? { disabledReason: 'Restricted by host' } : {})
          }))
        }
      }
    }
    if (method === 'agentSession.setOption') {
      if (!allowed) {
        return {
          ok: false,
          refusal: { code: 'agent_session_operation_invalid', message: 'Restricted by host' }
        }
      }
      retried = true
      return {
        ok: true,
        value: { key: 'permissions', value: 'full-access', options: { permissions: 'full-access' } }
      }
    }
    return null
  })
  const { result } = renderHook(() =>
    useStructuredAgentSession({ sessionId: 'session-1', agent: 'codex', target, isVisible: true })
  )
  await waitFor(() =>
    expect(
      result.current.optionSnapshot.find(({ id }) => id === 'permissions')?.permissionState
        ?.restoration
    ).toBe('failed')
  )
  await act(async () => {
    await expect(result.current.optionSurface.invokeAction('permissions')).rejects.toThrow(
      'could not be restored'
    )
  })
  expect(
    mocks.call.mock.calls.filter(([, method]) => method === 'agentSession.setOption')
  ).toHaveLength(1)
  expect(
    result.current.optionSnapshot.find(({ id }) => id === 'permissions')?.permissionState
      ?.restoration
  ).toBe('failed')
  act(() => {
    result.current.send('continue')
  })
  expect(mocks.send).toHaveBeenCalledOnce()
  allowed = true
  await act(async () => {
    await result.current.optionSurface.invokeAction('permissions')
  })
  await waitFor(() =>
    expect(
      result.current.optionSnapshot.find(({ id }) => id === 'permissions')?.permissionState
        ?.restoration
    ).toBeUndefined()
  )
  expect(result.current.optionSnapshot.find(({ id }) => id === 'permissions')).toMatchObject({
    valueSource: 'dispatched',
    permissionState: { desired: 'full-access', current: 'ask-for-approval' }
  })
  act(() => {
    result.current.send('next message')
  })
  expect(mocks.send).toHaveBeenCalledTimes(2)
  expect(mocks.settings).not.toHaveBeenCalled()
})
