// @vitest-environment happy-dom
import { useRef } from 'react'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { LinkActionPopover } from '@/components/link-actions/LinkActionPopover'
import { TooltipProvider } from '@/components/ui/tooltip'
import CommentMarkdown from '@/components/sidebar/CommentMarkdown'
import type { RuntimeFileOperationArgs } from '@/runtime/runtime-file-client'
import { useNativeChatLinkActions } from './use-native-chat-link-actions'

const mocks = vi.hoisted(() => {
  const fileContext: RuntimeFileOperationArgs = {
    settings: { activeRuntimeEnvironmentId: null },
    worktreeId: 'wt-1',
    worktreePath: '/repo'
  }
  return {
    openDetectedFilePath: vi.fn(),
    reveal: vi.fn(),
    download: vi.fn(),
    error: vi.fn(),
    fileContext,
    state: {
      settings: { terminalLinkActionPopoverEnabled: true },
      openSettingsPage: vi.fn(),
      openSettingsTarget: vi.fn()
    }
  }
})
vi.mock('@/store', () => ({
  useAppStore: Object.assign(
    (selector: (state: typeof mocks.state) => unknown) => selector(mocks.state),
    { getState: () => mocks.state }
  )
}))
vi.mock('@/i18n/i18n', () => ({
  translate: (_key: string, fallback: string, values?: Record<string, string>) =>
    fallback.replace(/{{(\w+)}}/g, (_, key: string) => values?.[key] ?? '')
}))
vi.mock('@/components/terminal-pane/terminal-file-open-routing', () => ({
  openDetectedFilePath: mocks.openDetectedFilePath,
  getTerminalFileContext: () => mocks.fileContext
}))
vi.mock('@/runtime/runtime-file-client', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  downloadRuntimeFile: mocks.download
}))
vi.mock('sonner', () => ({ toast: { error: mocks.error } }))

function Transcript({
  markdown = 'Open `src/main.ts:12:4`.',
  visible = true,
  sessionId = 'one'
}: {
  markdown?: string
  visible?: boolean
  sessionId?: string
}) {
  const root = useRef<HTMLDivElement>(null)
  const actions = useNativeChatLinkActions(
    { worktreeId: 'wt-1', worktreePath: '/repo', runtimeEnvironmentId: null },
    root,
    { sessionId, isVisible: visible }
  )
  return (
    <TooltipProvider>
      <div ref={root}>
        <CommentMarkdown
          variant="document"
          content={markdown}
          onLinkClick={actions.onLinkClick}
          linkifyFilePaths
          allowFileUriLinks
        />
        <LinkActionPopover request={actions.linkActionRequest} onClose={actions.closeLinkActions} />
      </div>
    </TooltipProvider>
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue('Macintosh')
  mocks.state.settings.terminalLinkActionPopoverEnabled = true
  mocks.fileContext = {
    settings: { activeRuntimeEnvironmentId: null },
    worktreeId: 'wt-1',
    worktreePath: '/repo'
  }
  mocks.download.mockResolvedValue({ canceled: false, destinationPath: '/downloads/main.ts' })
  mocks.reveal.mockResolvedValue({ ok: true })
  Object.defineProperty(window, 'api', {
    configurable: true,
    value: { shell: { openInFileManager: mocks.reveal } }
  })
})
afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('file destinations in chat responses', () => {
  it('offers Orca first and Finder without opening anything on the first click', async () => {
    render(<Transcript />)
    fireEvent.click(screen.getByRole('link', { name: 'src/main.ts:12:4' }))
    const open = await screen.findByRole('button', { name: /Open in Orca/ })
    const reveal = screen.getByRole('button', { name: /Reveal in Finder/ })
    expect(open.compareDocumentPosition(reveal) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(mocks.openDetectedFilePath).not.toHaveBeenCalled()
    expect(mocks.reveal).not.toHaveBeenCalled()
    fireEvent.click(open)
    expect(mocks.openDetectedFilePath).toHaveBeenCalledWith(
      '/repo/src/main.ts',
      12,
      4,
      expect.objectContaining({ worktreeId: 'wt-1' })
    )
  })

  it('reveals the file in Finder without treating the line suffix as part of its path', async () => {
    render(<Transcript />)
    fireEvent.click(screen.getByRole('link'))
    fireEvent.click(await screen.findByRole('button', { name: /Reveal in Finder/ }))
    await waitFor(() => expect(mocks.reveal).toHaveBeenCalledWith('/repo/src/main.ts'))
    expect(mocks.openDetectedFilePath).not.toHaveBeenCalled()
  })

  it('opens in Orca by default when destination menus are disabled', () => {
    mocks.state.settings.terminalLinkActionPopoverEnabled = false
    render(<Transcript />)
    fireEvent.click(screen.getByRole('link'))
    expect(mocks.openDetectedFilePath).toHaveBeenCalledOnce()
    expect(mocks.reveal).not.toHaveBeenCalled()
  })

  it('linkifies quoted filenames, bare filenames, dotfiles, and directory paths', () => {
    render(
      <Transcript markdown='Changed package.json, "README.md", `.gitignore`, `Makefile` and `src/components/`.' />
    )
    expect(screen.getAllByRole('link').map((link) => link.textContent)).toEqual([
      'package.json',
      'README.md',
      '.gitignore',
      'Makefile',
      'src/components/'
    ])
  })

  it.each(['Macintosh', 'Windows', 'Linux'])(
    'uses platform shortcuts and labels on %s',
    async (platform) => {
      vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue(platform)
      render(<Transcript />)
      const modifier = platform === 'Macintosh' ? { metaKey: true } : { ctrlKey: true }
      fireEvent.click(screen.getByRole('link'), modifier)
      expect(mocks.openDetectedFilePath).toHaveBeenCalledOnce()
      fireEvent.click(screen.getByRole('link'), { ...modifier, shiftKey: true })
      await waitFor(() => expect(mocks.reveal).toHaveBeenCalledWith('/repo/src/main.ts'))
      fireEvent.click(screen.getByRole('link'))
      const manager =
        platform === 'Macintosh'
          ? 'Finder'
          : platform === 'Windows'
            ? 'File Explorer'
            : 'File Manager'
      expect(
        await screen.findByRole('button', { name: new RegExp(`Reveal in ${manager}`) })
      ).toBeTruthy()
    }
  )

  it.each(['ssh', 'paired'])(
    'delegates download and reveal to the local application for %s',
    async (route) => {
      mocks.fileContext =
        route === 'ssh'
          ? { ...mocks.fileContext, connectionId: 'remote' }
          : { ...mocks.fileContext, settings: { activeRuntimeEnvironmentId: 'paired' } }
      render(<Transcript />)
      fireEvent.click(screen.getByRole('link'))
      fireEvent.click(await screen.findByRole('button', { name: /Download and reveal in Finder/ }))
      await waitFor(() =>
        expect(mocks.download).toHaveBeenCalledWith(
          mocks.fileContext,
          '/repo/src/main.ts',
          'main.ts',
          'reveal'
        )
      )
      expect(mocks.reveal).not.toHaveBeenCalled()
      expect(mocks.error).not.toHaveBeenCalled()
    }
  )

  it('keeps the existing error toast when downloaded-file reveal fails', async () => {
    mocks.fileContext.settings = { activeRuntimeEnvironmentId: 'paired' }
    mocks.download.mockRejectedValue(new Error('reveal failed'))
    render(<Transcript />)
    fireEvent.click(screen.getByRole('link'), { metaKey: true, shiftKey: true })
    await waitFor(() => expect(mocks.error).toHaveBeenCalledOnce())
    expect(mocks.reveal).not.toHaveBeenCalled()
  })

  it('dismisses a file destination choice when its chat is hidden', async () => {
    const { rerender } = render(<Transcript />)
    fireEvent.click(screen.getByRole('link'))
    await screen.findByRole('button', { name: /Open in Orca/ })
    rerender(<Transcript visible={false} />)
    expect(screen.queryByRole('button', { name: /Open in Orca/ })).toBeNull()
  })
})
