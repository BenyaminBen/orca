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
    current?: 'ask-for-approval' | 'full-access'
    confirm?: (options: ConfirmationDialogOptions) => Promise<boolean>
  } = {}
) {
  const descriptor = nativeChatPermissionOption(
    {
      current: options.current ?? 'ask-for-approval',
      choices: CODEX_PERMISSION_MODES.map(({ value }) => ({ value }))
    },
    'agent-session'
  )
  const setOption = vi.fn(async () => ({ snapshot: [descriptor] }))
  const surface: SessionOptionsSurface = {
    getSnapshot: () => [descriptor],
    setOption,
    invokeAction: async () => ({ snapshot: [descriptor] }),
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
      </TooltipProvider>
    </ConfirmationDialogContext.Provider>
  )
  return { setOption, confirm }
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
