// @vitest-environment happy-dom

import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ConfirmationDialogOptions } from '@/components/confirmation-dialog-context'
import { ConfirmationDialogContext } from '@/components/confirmation-dialog-context'
import { TooltipProvider } from '@/components/ui/tooltip'
import type {
  AgentJournalRenderItem,
  AgentJournalSubmission
} from '../../../../shared/agent-session-journal-types'
import type { AgentSessionOptionsResult } from '../../../../shared/agent-session-wire'
import { CODEX_PERMISSION_MODES, codexPermissionPolicy } from '../../../../shared/codex-permissions'
import type { RuntimeClientTarget } from '@/runtime/runtime-rpc-client'
import { NativeChatPermissionPicker } from './NativeChatPermissionPicker'
import { useStructuredAgentSession } from './use-structured-agent-session'

const mocks = vi.hoisted(() => ({
  call: vi.fn(),
  confirm: vi.fn<(options: ConfirmationDialogOptions) => Promise<boolean>>(),
  error: vi.fn(),
  operationId: vi.fn(() => 'operation-1'),
  enqueueSettingsWrite: vi.fn(),
  settings: { skipFullAccessConfirm: false },
  updateSettings: vi.fn(),
  openSettingsPage: vi.fn(),
  openSettingsTarget: vi.fn()
}))

let items: AgentJournalRenderItem[] = []
let submissions: AgentJournalSubmission[] = []
let fence = 3

vi.mock('@/runtime/structured-agent-session-client', () => ({
  callStructuredAgentSession: mocks.call
}))
vi.mock('@/store', () => ({
  useAppStore: (selector: (state: typeof mocks) => unknown) => selector(mocks)
}))
vi.mock('@/i18n/i18n', () => ({
  translate: (_key: string, fallback: string, values?: Record<string, string>) =>
    fallback.replace(/{{(\w+)}}/g, (_, key: string) => values?.[key] ?? '')
}))
vi.mock('sonner', () => ({ toast: { error: mocks.error } }))
vi.mock('./native-chat-session-option-settings-write', () => ({
  enqueueSessionOptionSettingsWrite: mocks.enqueueSettingsWrite
}))
vi.mock('./use-structured-agent-session-read', () => ({
  useStructuredAgentSessionRead: () => ({
    state: {
      fence,
      commands: undefined,
      items,
      submissions,
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
  structuredSessionOperationId: mocks.operationId,
  useStructuredAgentSessionOutbox: () => ({
    outbox: [],
    blockedClientMessageId: null,
    error: null,
    send: vi.fn(),
    retry: vi.fn()
  })
}))

const OPTIONS: AgentSessionOptionsResult = {
  models: [
    {
      id: 'gpt-live',
      label: 'GPT Live',
      isDefault: true,
      defaultEffort: 'medium',
      efforts: [
        { value: 'medium', label: 'Medium' },
        { value: 'high', label: 'High' }
      ]
    }
  ],
  current: { model: 'gpt-live', effort: 'medium' },
  permissions: {
    current: 'ask-for-approval',
    policy: codexPermissionPolicy('ask-for-approval'),
    choices: CODEX_PERMISSION_MODES.map(({ value }) => ({ value }))
  }
}
const LOCAL_TARGET_ONE: RuntimeClientTarget = { kind: 'local' }
const LOCAL_TARGET_TWO: RuntimeClientTarget = { kind: 'local' }
const REMOTE_TARGET: RuntimeClientTarget = { kind: 'environment', environmentId: 'runtime-1' }

function deferred<T>() {
  let settle: ((value: T) => void) | null = null
  const promise = new Promise<T>((resolve) => {
    settle = resolve
  })
  return {
    promise,
    resolve(value: T): void {
      if (!settle) {
        throw new Error('Deferred promise is unavailable')
      }
      settle(value)
    }
  }
}

function PermissionHarness({
  renderVersion,
  sessionId,
  target
}: {
  renderVersion: number
  sessionId?: string
  target: RuntimeClientTarget
}): React.JSX.Element | null {
  const controller = useStructuredAgentSession({
    sessionId: sessionId ?? 'session-1',
    target,
    agent: 'codex',
    isVisible: true
  })
  const descriptor = controller.optionSnapshot.find(({ id }) => id === 'permissions')
  if (!descriptor) {
    return null
  }
  return (
    <div data-render-version={renderVersion}>
      <NativeChatPermissionPicker
        surface={controller.optionSurface}
        descriptor={descriptor}
        isWorking={controller.isWorking}
      />
    </div>
  )
}

function permissionTree(props: {
  renderVersion: number
  sessionId?: string
  target: RuntimeClientTarget
}): React.JSX.Element {
  return (
    <ConfirmationDialogContext.Provider value={mocks.confirm}>
      <TooltipProvider>
        <PermissionHarness {...props} />
      </TooltipProvider>
    </ConfirmationDialogContext.Provider>
  )
}

async function openPermissionMenu(): Promise<void> {
  fireEvent.pointerDown(screen.getByRole('button', { name: /Permissions/ }), {
    button: 0,
    ctrlKey: false,
    pointerType: 'mouse'
  })
  await screen.findByRole('menuitemradio', { name: /Full Access/ })
}

beforeEach(() => {
  vi.clearAllMocks()
  items = []
  submissions = []
  fence = 3
  mocks.settings.skipFullAccessConfirm = false
})
afterEach(cleanup)

describe('structured permission confirmation ownership', () => {
  it('applies acceptance through the refreshed surface for the same conversation', async () => {
    const refreshed = deferred<AgentSessionOptionsResult>()
    const confirmation = deferred<boolean>()
    let optionReads = 0
    mocks.confirm.mockReturnValue(confirmation.promise)
    mocks.call.mockImplementation((_target, method) => {
      if (method === 'agentSession.options') {
        optionReads += 1
        return optionReads === 1 ? Promise.resolve(OPTIONS) : refreshed.promise
      }
      if (method === 'agentSession.setOption') {
        return Promise.resolve({
          ok: true,
          value: {
            key: 'permissions',
            value: 'full-access',
            options: { permissions: 'full-access' }
          }
        })
      }
      return Promise.resolve(null)
    })

    const view = render(permissionTree({ renderVersion: 1, target: LOCAL_TARGET_ONE }))
    await screen.findByRole('button', { name: /Permissions Ask for approval/ })
    await openPermissionMenu()
    fireEvent.click(screen.getByRole('menuitemradio', { name: /Full Access/ }))
    await waitFor(() => expect(mocks.confirm).toHaveBeenCalledOnce())

    view.rerender(permissionTree({ renderVersion: 2, target: LOCAL_TARGET_TWO }))
    await waitFor(() => expect(optionReads).toBe(2))
    await act(async () => {
      refreshed.resolve({ ...OPTIONS, current: { model: 'gpt-live', effort: 'high' } })
      await refreshed.promise
    })
    await act(async () => {
      confirmation.resolve(true)
      await confirmation.promise
    })

    await waitFor(() =>
      expect(
        mocks.call.mock.calls.filter(([, method]) => method === 'agentSession.setOption')
      ).toHaveLength(1)
    )
    expect(mocks.error).not.toHaveBeenCalled()
  })

  it('does not revive confirmation after the session changes away and back', async () => {
    const confirmation = deferred<boolean>()
    mocks.confirm.mockReturnValue(confirmation.promise)
    mocks.call.mockImplementation((_target, method) => {
      if (method === 'agentSession.options') {
        return Promise.resolve(OPTIONS)
      }
      if (method === 'agentSession.setOption') {
        return Promise.resolve({
          ok: true,
          value: { key: 'permissions', value: 'full-access' }
        })
      }
      return Promise.resolve(null)
    })

    const view = render(
      permissionTree({ renderVersion: 1, sessionId: 'session-a', target: LOCAL_TARGET_ONE })
    )
    await screen.findByRole('button', { name: /Permissions Ask for approval/ })
    await openPermissionMenu()
    fireEvent.click(screen.getByRole('menuitemradio', { name: /Full Access/ }))
    await waitFor(() => expect(mocks.confirm).toHaveBeenCalledOnce())

    view.rerender(
      permissionTree({ renderVersion: 2, sessionId: 'session-b', target: LOCAL_TARGET_ONE })
    )
    await screen.findByRole('button', { name: /Permissions Ask for approval/ })
    view.rerender(
      permissionTree({ renderVersion: 3, sessionId: 'session-a', target: LOCAL_TARGET_ONE })
    )
    await screen.findByRole('button', { name: /Permissions Ask for approval/ })
    await act(async () => {
      confirmation.resolve(true)
      await confirmation.promise
    })

    await waitFor(() => expect(mocks.error).toHaveBeenCalledOnce())
    expect(
      mocks.call.mock.calls.filter(([, method]) => method === 'agentSession.setOption')
    ).toEqual([])
  })

  it('drops accepted confirmation after the picker unmounts', async () => {
    const confirmation = deferred<boolean>()
    mocks.confirm.mockReturnValue(confirmation.promise)
    mocks.call.mockImplementation((_target, method) =>
      Promise.resolve(method === 'agentSession.options' ? OPTIONS : null)
    )

    const view = render(permissionTree({ renderVersion: 1, target: LOCAL_TARGET_ONE }))
    await screen.findByRole('button', { name: /Permissions Ask for approval/ })
    await openPermissionMenu()
    fireEvent.click(screen.getByRole('menuitemradio', { name: /Full Access/ }))
    await waitFor(() => expect(mocks.confirm).toHaveBeenCalledOnce())
    view.unmount()
    await act(async () => {
      confirmation.resolve(true)
      await confirmation.promise
    })

    expect(
      mocks.call.mock.calls.filter(([, method]) => method === 'agentSession.setOption')
    ).toEqual([])
    expect(mocks.error).not.toHaveBeenCalled()
  })

  it('rejects acceptance when a turn starts during confirmation', async () => {
    const confirmation = deferred<boolean>()
    mocks.confirm.mockReturnValue(confirmation.promise)
    mocks.call.mockImplementation((_target, method) =>
      Promise.resolve(method === 'agentSession.options' ? OPTIONS : null)
    )

    const view = render(permissionTree({ renderVersion: 1, target: LOCAL_TARGET_ONE }))
    await screen.findByRole('button', { name: /Permissions Ask for approval/ })
    await openPermissionMenu()
    fireEvent.click(screen.getByRole('menuitemradio', { name: /Full Access/ }))
    await waitFor(() => expect(mocks.confirm).toHaveBeenCalledOnce())
    submissions = [
      {
        clientMessageId: 'client-1',
        fence: 3,
        payloadFingerprint: 'fingerprint-1',
        dispatchState: 'pending',
        providerItemId: null,
        reason: null,
        submittedAt: 1,
        resolvedAt: null
      }
    ]
    view.rerender(permissionTree({ renderVersion: 2, target: LOCAL_TARGET_ONE }))
    await act(async () => {
      confirmation.resolve(true)
      await confirmation.promise
    })

    await waitFor(() => expect(mocks.error).toHaveBeenCalledOnce())
    expect(
      mocks.call.mock.calls.filter(([, method]) => method === 'agentSession.setOption')
    ).toEqual([])
  })

  it.each([
    { transition: 'target', nextTarget: REMOTE_TARGET, nextFence: 3 },
    { transition: 'fence', nextTarget: LOCAL_TARGET_ONE, nextFence: 4 }
  ])('rejects acceptance after a $transition change', async ({ nextTarget, nextFence }) => {
    const confirmation = deferred<boolean>()
    mocks.confirm.mockReturnValue(confirmation.promise)
    mocks.call.mockImplementation((_target, method) =>
      Promise.resolve(method === 'agentSession.options' ? OPTIONS : null)
    )

    const view = render(permissionTree({ renderVersion: 1, target: LOCAL_TARGET_ONE }))
    await screen.findByRole('button', { name: /Permissions Ask for approval/ })
    await openPermissionMenu()
    fireEvent.click(screen.getByRole('menuitemradio', { name: /Full Access/ }))
    await waitFor(() => expect(mocks.confirm).toHaveBeenCalledOnce())
    fence = nextFence
    view.rerender(permissionTree({ renderVersion: 2, target: nextTarget }))
    await screen.findByRole('button', { name: /Permissions Ask for approval/ })
    await act(async () => {
      confirmation.resolve(true)
      await confirmation.promise
    })

    await waitFor(() => expect(mocks.error).toHaveBeenCalledOnce())
    expect(
      mocks.call.mock.calls.filter(([, method]) => method === 'agentSession.setOption')
    ).toEqual([])
  })

  it('uses current admission when Full Access becomes unavailable during confirmation', async () => {
    const refreshed = deferred<AgentSessionOptionsResult>()
    const confirmation = deferred<boolean>()
    let optionReads = 0
    mocks.confirm.mockReturnValue(confirmation.promise)
    mocks.call.mockImplementation((_target, method) => {
      if (method === 'agentSession.options') {
        optionReads += 1
        return optionReads === 1 ? Promise.resolve(OPTIONS) : refreshed.promise
      }
      return Promise.resolve(null)
    })

    const view = render(permissionTree({ renderVersion: 1, target: LOCAL_TARGET_ONE }))
    await screen.findByRole('button', { name: /Permissions Ask for approval/ })
    await openPermissionMenu()
    fireEvent.click(screen.getByRole('menuitemradio', { name: /Full Access/ }))
    await waitFor(() => expect(mocks.confirm).toHaveBeenCalledOnce())
    view.rerender(permissionTree({ renderVersion: 2, target: LOCAL_TARGET_TWO }))
    await waitFor(() => expect(optionReads).toBe(2))
    await act(async () => {
      refreshed.resolve({
        ...OPTIONS,
        permissions: {
          ...OPTIONS.permissions,
          choices: [{ value: 'ask-for-approval' }]
        }
      })
      await refreshed.promise
    })
    await act(async () => {
      confirmation.resolve(true)
      await confirmation.promise
    })

    await waitFor(() => expect(mocks.error).toHaveBeenCalledOnce())
    expect(
      mocks.call.mock.calls.filter(([, method]) => method === 'agentSession.setOption')
    ).toEqual([])
  })
})
