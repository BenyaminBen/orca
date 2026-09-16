// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ConfirmationDialogOptions } from '@/components/confirmation-dialog-context'
import { ConfirmationDialogContext } from '@/components/confirmation-dialog-context'
import { TooltipProvider } from '@/components/ui/tooltip'
import { CODEX_PERMISSION_MODES } from '../../../../shared/codex-permissions'
import { nativeChatPermissionOption } from '../../../../shared/native-chat-permission-option'
import type { SessionOptionsSurface } from '../../../../shared/native-chat-session-options'
import { NativeChatPermissionPicker } from './NativeChatPermissionPicker'
import { NativeChatPermissionRecovery } from './NativeChatPermissionRecovery'

const mocks = vi.hoisted(() => ({
  settings: { skipFullAccessConfirm: false },
  updateSettings: vi.fn(),
  openSettingsPage: vi.fn(),
  openSettingsTarget: vi.fn()
}))
vi.mock('@/store', () => ({
  useAppStore: (selector: (state: typeof mocks) => unknown) => selector(mocks)
}))
vi.mock('@/i18n/i18n', () => ({
  translate: (_key: string, fallback: string, values?: Record<string, string>) =>
    fallback.replace(/{{(\w+)}}/g, (_, key: string) => values?.[key] ?? '')
}))

function fixture(
  options: {
    working?: boolean
    current?: 'ask-for-approval' | 'full-access' | 'custom' | null
    confirm?: (options: ConfirmationDialogOptions) => Promise<boolean>
    recovery?: { desired: 'full-access'; restoration: 'failed' | 'restoring' }
    pending?: 'full-access'
  } = {}
) {
  const descriptor = nativeChatPermissionOption(
    {
      current: options.current === null ? undefined : (options.current ?? 'ask-for-approval'),
      choices: CODEX_PERMISSION_MODES.map(({ value }) => ({ value })),
      ...options.recovery,
      ...(options.pending ? { pending: options.pending, desired: options.pending } : {})
    },
    'agent-session'
  )
  const setOption = vi.fn(async () => ({ snapshot: [descriptor] }))
  const invokeAction = vi.fn(async () => ({ snapshot: [descriptor] }))
  const surface: SessionOptionsSurface = {
    getSnapshot: () => [descriptor],
    setOption,
    invokeAction,
    subscribe: () => () => {}
  }
  const confirm = vi.fn(options.confirm ?? (async () => true))
  render(
    <ConfirmationDialogContext.Provider value={confirm}>
      <TooltipProvider>
        <NativeChatPermissionPicker
          surface={surface}
          descriptor={descriptor}
          isWorking={options.working ?? false}
        />
        <NativeChatPermissionRecovery
          surface={surface}
          descriptor={descriptor}
          isWorking={options.working ?? false}
        />
      </TooltipProvider>
    </ConfirmationDialogContext.Provider>
  )
  return { setOption, confirm, invokeAction }
}

async function openMenu() {
  fireEvent.pointerDown(screen.getByRole('button', { name: /Permissions/ }), {
    button: 0,
    ctrlKey: false,
    pointerType: 'mouse'
  })
  await waitFor(() => expect(screen.getAllByRole('menuitemradio')).toHaveLength(3))
}

beforeEach(() => {
  mocks.settings.skipFullAccessConfirm = false
  vi.clearAllMocks()
  mocks.updateSettings.mockResolvedValue(undefined)
})
afterEach(cleanup)

describe('permission selector', () => {
  it('lets the user adopt the effective fallback as the new selected mode after recovery failure', async () => {
    const { setOption } = fixture({
      current: 'ask-for-approval',
      recovery: { desired: 'full-access', restoration: 'failed' }
    })
    await openMenu()
    fireEvent.click(screen.getByRole('menuitemradio', { name: /Ask for approval/ }))
    await waitFor(() => expect(setOption).toHaveBeenCalledWith('permissions', 'ask-for-approval'))
  })
  it('visibly distinguishes a structured selection awaiting its next message from active permissions', () => {
    const { invokeAction } = fixture({ current: 'ask-for-approval', pending: 'full-access' })
    expect(screen.getByRole('button', { name: 'Permissions Full Access' })).toBeTruthy()
    const status = screen.getByRole('status')
    expect(status.textContent).toContain(
      'Selected permissions will be applied to the next message.'
    )
    expect(status.textContent).toContain('Selected: Full Access. Active: Ask for approval.')
    expect(screen.queryByRole('button', { name: 'Retry restoration' })).toBeNull()
    expect(invokeAction).not.toHaveBeenCalled()
  })
  it.each(['ask-for-approval', null] as const)(
    'shows selected and effective permissions visibly after failed restoration (%s)',
    async (current) => {
      const { confirm, invokeAction } = fixture({
        current,
        recovery: { desired: 'full-access', restoration: 'failed' }
      })
      const status = screen.getByRole('status')
      expect(status.textContent).toContain('Selected: Full Access.')
      expect(status.textContent).toContain(`Active: ${current ? 'Ask for approval' : 'Unknown'}.`)
      expect(status.textContent).toContain('Messages use the active permissions.')
      fireEvent.click(screen.getByRole('button', { name: 'Retry restoration' }))
      await waitFor(() => expect(invokeAction).toHaveBeenCalledWith('permissions'))
      expect(confirm).not.toHaveBeenCalled()
    }
  )
  it.each([
    { current: null, label: 'Unknown', message: 'Current permissions have not been reported.' },
    { current: 'custom', label: 'Custom', message: 'Custom permissions detected.' }
  ] as const)(
    'explains $label on hover and allows selecting a preset',
    async ({ current, label, message }) => {
      const { setOption } = fixture({ current })
      const button = screen.getByRole('button', { name: `Permissions ${label}` })
      fireEvent.pointerMove(button, { pointerType: 'mouse' })
      expect((await screen.findByRole('tooltip')).textContent).toContain(message)
      await openMenu()
      fireEvent.click(screen.getByRole('menuitemradio', { name: /Ask for approval/ }))
      await waitFor(() => expect(setOption).toHaveBeenCalledWith('permissions', 'ask-for-approval'))
    }
  )
  it('distinguishes unreported permissions from a known custom policy', async () => {
    fixture({ current: null })
    expect(screen.getByRole('button', { name: /Permissions Unknown/ })).toBeTruthy()
    await openMenu()
    expect(screen.getAllByRole('menuitemradio')).toHaveLength(3)
    expect(screen.queryByRole('menuitemradio', { name: /Unknown|Custom/ })).toBeNull()
  })

  it('shows the three official modes and emphasizes Full Access without a special color', async () => {
    fixture({ current: 'full-access' })
    const label = screen
      .getByRole('button', { name: 'Permissions Full Access' })
      .querySelector('span')
    expect(label?.classList.contains('font-bold')).toBe(true)
    expect(label?.className).not.toMatch(/red|destructive/)
    await openMenu()
    expect(screen.getAllByRole('menuitemradio').map((row) => row.textContent)).toEqual(
      expect.arrayContaining([
        expect.stringContaining('Ask for approval'),
        expect.stringContaining('Approve for me'),
        expect.stringContaining('Full Access')
      ])
    )
  })

  it('does not mutate or remember confirmation suppression after cancellation', async () => {
    const { setOption, confirm } = fixture({ confirm: async () => false })
    await openMenu()
    fireEvent.click(screen.getByRole('menuitemradio', { name: /Full Access/ }))
    await waitFor(() => expect(confirm).toHaveBeenCalledOnce())
    expect(setOption).not.toHaveBeenCalled()
    expect(mocks.updateSettings).not.toHaveBeenCalled()
  })

  it('persists the confirmed checkbox globally and switches only the selected chat', async () => {
    const { setOption } = fixture({
      confirm: async (options) => {
        options.dontAskAgain?.onConfirmed()
        return true
      }
    })
    await openMenu()
    fireEvent.click(screen.getByRole('menuitemradio', { name: /Full Access/ }))
    await waitFor(() => expect(setOption).toHaveBeenCalledWith('permissions', 'full-access'))
    expect(mocks.updateSettings).toHaveBeenCalledWith({ skipFullAccessConfirm: true })
  })

  it('honors the global suppression preference in another chat', async () => {
    mocks.settings.skipFullAccessConfirm = true
    const { setOption, confirm } = fixture()
    await openMenu()
    fireEvent.click(screen.getByRole('menuitemradio', { name: /Full Access/ }))
    await waitFor(() => expect(setOption).toHaveBeenCalledOnce())
    expect(confirm).not.toHaveBeenCalled()
  })

  it('does not confirm inherited Full Access and disables the control during a turn', async () => {
    const { confirm, setOption } = fixture({ current: 'full-access', working: true })
    const button = screen.getByRole('button', { name: 'Permissions Full Access' })
    expect(button.hasAttribute('disabled')).toBe(true)
    await act(async () => fireEvent.click(button))
    expect(confirm).not.toHaveBeenCalled()
    expect(setOption).not.toHaveBeenCalled()
  })
})
