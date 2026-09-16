// @vitest-environment happy-dom
import { useRef } from 'react'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { LinkActionPopover } from '@/components/link-actions/LinkActionPopover'
import { TooltipProvider } from '@/components/ui/tooltip'
import CommentMarkdown from '@/components/sidebar/CommentMarkdown'
import type { RuntimeFileOperationArgs } from '@/runtime/runtime-file-client'
import { folderWorkspaceKey } from '../../../../shared/workspace-scope'
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
    downloadFolder: vi.fn(),
    stat: vi.fn(),
    connectionIdForFile: vi.fn((): string | null | undefined => null),
    resolvePaneWslDistro: vi.fn((): string | null => null),
    error: vi.fn(),
    fileContext,
    state: {
      settings: { terminalLinkActionPopoverEnabled: true },
      sshConnectionStates: new Map<
        string,
        { supportsFolderDownload?: boolean; connectionGeneration?: number }
      >(),
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
vi.mock('@/lib/connection-context', () => ({
  getConnectionIdForFile: mocks.connectionIdForFile
}))
vi.mock('@/components/terminal-pane/terminal-file-open-routing', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  openDetectedFilePath: mocks.openDetectedFilePath,
  getTerminalFileContext: () => mocks.fileContext
}))
vi.mock('@/components/terminal-pane/terminal-pane-wsl-distro', () => ({
  resolvePaneWslDistro: mocks.resolvePaneWslDistro
}))
vi.mock('@/runtime/runtime-file-client', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  downloadRuntimeFile: mocks.download,
  statRuntimePath: mocks.stat
}))
vi.mock('sonner', () => ({ toast: { error: mocks.error } }))

const defaultLinkContext = {
  worktreeId: 'wt-1',
  worktreePath: '/repo',
  runtimeEnvironmentId: null
}

function Transcript({
  markdown = 'Open `src/main.ts:12:4`.',
  visible = true,
  sessionId = 'one',
  linkContext = defaultLinkContext
}: {
  markdown?: string
  visible?: boolean
  sessionId?: string
  linkContext?: {
    worktreeId: string
    worktreePath: string
    runtimeEnvironmentId: string | null
  }
}) {
  const root = useRef<HTMLDivElement>(null)
  const actions = useNativeChatLinkActions(linkContext, root, { sessionId, isVisible: visible })
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

function installDeferredStat(): (value: {
  size: number
  isDirectory: boolean
  mtime: number
}) => void {
  let resolveStat = (_value: { size: number; isDirectory: boolean; mtime: number }): void => {
    throw new Error('stat resolver was not installed')
  }
  mocks.stat.mockImplementation(
    () =>
      new Promise((resolve) => {
        resolveStat = resolve
      })
  )
  return (value) => resolveStat(value)
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue('Macintosh')
  mocks.state.settings.terminalLinkActionPopoverEnabled = true
  mocks.state.sshConnectionStates.clear()
  mocks.connectionIdForFile.mockReturnValue(null)
  mocks.resolvePaneWslDistro.mockReturnValue(null)
  mocks.fileContext = {
    settings: { activeRuntimeEnvironmentId: null },
    worktreeId: 'wt-1',
    worktreePath: '/repo'
  }
  mocks.download.mockResolvedValue({ canceled: false, destinationPath: '/downloads/main.ts' })
  mocks.downloadFolder.mockResolvedValue({
    canceled: false,
    destinationPath: '/downloads/components'
  })
  mocks.stat.mockResolvedValue({ size: 10, isDirectory: false, mtime: 123 })
  mocks.reveal.mockResolvedValue({ ok: true })
  Object.defineProperty(window, 'api', {
    configurable: true,
    value: {
      shell: { openInFileManager: mocks.reveal },
      fs: { downloadFolder: mocks.downloadFolder }
    }
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
          : {
              ...mocks.fileContext,
              connectionId: 'stale-ssh',
              settings: { activeRuntimeEnvironmentId: 'paired' }
            }
      mocks.connectionIdForFile.mockReturnValue(route === 'ssh' ? 'remote' : 'stale-ssh')
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

  it.each([
    {
      label: 'UNC worktree',
      worktreePath: '\\\\wsl.localhost\\Ubuntu\\home\\repo',
      target: '/home/repo/result.txt',
      expected: '\\\\wsl.localhost\\Ubuntu\\home\\repo\\result.txt'
    },
    {
      label: 'Windows-drive worktree',
      worktreePath: 'C:\\work',
      target: '/mnt/c/work/result.txt',
      expected: 'C:\\work\\result.txt'
    }
  ])(
    'maps local WSL paths before reveal for a $label',
    async ({ worktreePath, target, expected }) => {
      mocks.resolvePaneWslDistro.mockReturnValue('Ubuntu')
      render(
        <Transcript
          markdown={`Open \`${target}\`.`}
          linkContext={{ worktreeId: 'wt-1', worktreePath, runtimeEnvironmentId: null }}
        />
      )
      fireEvent.click(screen.getByRole('link'))
      fireEvent.click(await screen.findByRole('button', { name: /Reveal in Finder/ }))
      await waitFor(() => expect(mocks.reveal).toHaveBeenCalledWith(expected))
    }
  )

  it('keeps Open in Orca on the same local WSL distro interpretation', async () => {
    mocks.resolvePaneWslDistro.mockReturnValue('Ubuntu')
    render(
      <Transcript
        markdown="Open `/mnt/c/work/result.txt`."
        linkContext={{ worktreeId: 'wt-1', worktreePath: 'C:\\work', runtimeEnvironmentId: null }}
      />
    )
    fireEvent.click(screen.getByRole('link'))
    fireEvent.click(await screen.findByRole('button', { name: /Open in Orca/ }))
    expect(mocks.openDetectedFilePath).toHaveBeenCalledWith(
      '/mnt/c/work/result.txt',
      null,
      null,
      expect.objectContaining({ wslDistro: 'Ubuntu' })
    )
  })

  it('downloads a supported direct SSH directory and reveals the promoted local folder', async () => {
    const workspaceId = folderWorkspaceKey('folder-1')
    mocks.connectionIdForFile.mockReturnValue('ssh-1')
    mocks.fileContext = { ...mocks.fileContext, connectionId: 'ssh-1' }
    mocks.state.sshConnectionStates.set('ssh-1', { supportsFolderDownload: true })
    mocks.stat.mockResolvedValue({ size: 0, isDirectory: true, mtime: 123 })
    render(
      <Transcript
        markdown="Open `src/components/`."
        linkContext={{ worktreeId: workspaceId, worktreePath: '/repo', runtimeEnvironmentId: null }}
      />
    )
    fireEvent.click(screen.getByRole('link'))
    expect(await screen.findByRole('button', { name: /Open in Orca/ })).toBeTruthy()
    fireEvent.click(await screen.findByRole('button', { name: /Download and reveal in Finder/ }))
    await waitFor(() =>
      expect(mocks.downloadFolder).toHaveBeenCalledWith({
        dirPath: '/repo/src/components',
        connectionId: 'ssh-1',
        postDownloadAction: 'reveal'
      })
    )
    expect(mocks.connectionIdForFile).toHaveBeenCalledWith(workspaceId, '/repo/src/components')
    expect(mocks.download).not.toHaveBeenCalled()
  })

  it('rechecks folder capability when a selected action starts', async () => {
    mocks.connectionIdForFile.mockReturnValue('ssh-1')
    mocks.fileContext = { ...mocks.fileContext, connectionId: 'ssh-1' }
    mocks.state.sshConnectionStates.set('ssh-1', { supportsFolderDownload: true })
    mocks.stat.mockResolvedValue({ size: 0, isDirectory: true, mtime: 123 })
    render(<Transcript markdown="Open `src/components/`." />)
    fireEvent.click(screen.getByRole('link'))
    const download = await screen.findByRole('button', { name: /Download and reveal in Finder/ })
    mocks.state.sshConnectionStates.set('ssh-1', { supportsFolderDownload: false })
    fireEvent.click(download)
    await waitFor(() => expect(mocks.error).toHaveBeenCalledWith(expect.stringMatching(/cannot/)))
    expect(mocks.downloadFolder).not.toHaveBeenCalled()
  })

  it.each(['unsupported SSH', 'paired runtime'])(
    'keeps only Open in Orca for an %s directory',
    async (owner) => {
      mocks.stat.mockResolvedValue({ size: 0, isDirectory: true, mtime: 123 })
      if (owner === 'unsupported SSH') {
        mocks.connectionIdForFile.mockReturnValue('ssh-1')
        mocks.fileContext = { ...mocks.fileContext, connectionId: 'ssh-1' }
      } else {
        mocks.connectionIdForFile.mockReturnValue('stale-ssh')
        mocks.state.sshConnectionStates.set('stale-ssh', { supportsFolderDownload: true })
        mocks.fileContext = {
          ...mocks.fileContext,
          connectionId: 'stale-ssh',
          settings: { activeRuntimeEnvironmentId: 'paired' }
        }
      }
      render(<Transcript markdown="Open `src/components/`." />)
      fireEvent.click(screen.getByRole('link'))
      expect(await screen.findByRole('button', { name: /Open in Orca/ })).toBeTruthy()
      await waitFor(() => expect(mocks.stat).toHaveBeenCalledOnce())
      expect(screen.queryByRole('button', { name: /Download and reveal/ })).toBeNull()
      expect(mocks.download).not.toHaveBeenCalled()
      expect(mocks.downloadFolder).not.toHaveBeenCalled()
    }
  )

  it('blocks direct activation for an unsupported SSH directory', async () => {
    mocks.connectionIdForFile.mockReturnValue('ssh-1')
    mocks.fileContext = { ...mocks.fileContext, connectionId: 'ssh-1' }
    mocks.stat.mockResolvedValue({ size: 0, isDirectory: true, mtime: 123 })
    render(<Transcript markdown="Open `src/components/`." />)
    fireEvent.click(screen.getByRole('link'), { metaKey: true, shiftKey: true })
    await waitFor(() => expect(mocks.error).toHaveBeenCalledWith(expect.stringMatching(/cannot/)))
    expect(mocks.download).not.toHaveBeenCalled()
    expect(mocks.downloadFolder).not.toHaveBeenCalled()
  })

  it('keeps the primary action when remote metadata is unavailable', async () => {
    mocks.connectionIdForFile.mockReturnValue('ssh-1')
    mocks.fileContext = { ...mocks.fileContext, connectionId: 'ssh-1' }
    mocks.stat.mockRejectedValue(new Error('stat failed'))
    render(<Transcript />)
    fireEvent.click(screen.getByRole('link'))
    expect(await screen.findByRole('button', { name: /Open in Orca/ })).toBeTruthy()
    await waitFor(() => expect(mocks.stat).toHaveBeenCalledOnce())
    expect(screen.queryByRole('button', { name: /Download and reveal/ })).toBeNull()
    expect(mocks.error).not.toHaveBeenCalled()
  })

  it('does not reopen a dismissed menu when remote metadata arrives late', async () => {
    const resolveStat = installDeferredStat()
    mocks.connectionIdForFile.mockReturnValue('ssh-1')
    mocks.fileContext = { ...mocks.fileContext, connectionId: 'ssh-1' }
    render(<Transcript />)
    fireEvent.click(screen.getByRole('link'))
    fireEvent.click(await screen.findByRole('button', { name: /Open in Orca/ }))
    expect(screen.queryByRole('button', { name: /Open in Orca/ })).toBeNull()
    await act(async () => resolveStat({ size: 10, isDirectory: false, mtime: 123 }))
    expect(screen.queryByRole('button', { name: /Download and reveal/ })).toBeNull()
  })

  it.each(['session', 'root', 'web', 'unmount'] as const)(
    'drops late metadata after a %s lifecycle change',
    async (change) => {
      const resolveStat = installDeferredStat()
      mocks.connectionIdForFile.mockReturnValue('ssh-1')
      mocks.fileContext = { ...mocks.fileContext, connectionId: 'ssh-1' }
      const markdown = 'Open `src/main.ts`. See [web](https://example.com).'
      const view = render(<Transcript markdown={markdown} />)
      fireEvent.click(screen.getByRole('link', { name: 'src/main.ts' }))
      await screen.findByRole('button', { name: /Open in Orca/ })
      if (change === 'unmount') {
        view.unmount()
      } else if (change === 'web') {
        fireEvent.click(screen.getByRole('link', { name: 'web' }))
      } else {
        view.rerender(
          <Transcript
            markdown={markdown}
            sessionId={change === 'session' ? 'two' : 'one'}
            linkContext={{
              worktreeId: 'wt-1',
              worktreePath: change === 'root' ? '/next-repo' : '/repo',
              runtimeEnvironmentId: null
            }}
          />
        )
      }
      await act(async () => resolveStat({ size: 10, isDirectory: false, mtime: 123 }))
      expect(screen.queryByRole('button', { name: /Download and reveal/ })).toBeNull()
      expect(mocks.download).not.toHaveBeenCalled()
    }
  )

  it('drops a pending direct download after another link click', async () => {
    const resolveStat = installDeferredStat()
    mocks.connectionIdForFile.mockReturnValue('ssh-1')
    mocks.fileContext = { ...mocks.fileContext, connectionId: 'ssh-1' }
    render(<Transcript markdown="Open `src/main.ts`. See [web](https://example.com)." />)
    fireEvent.click(screen.getByRole('link', { name: 'src/main.ts' }), {
      metaKey: true,
      shiftKey: true
    })
    fireEvent.click(screen.getByRole('link', { name: 'web' }))
    await act(async () => resolveStat({ size: 10, isDirectory: false, mtime: 123 }))
    expect(mocks.download).not.toHaveBeenCalled()
    expect(mocks.error).not.toHaveBeenCalled()
  })

  it('refuses Open in Orca while the file owner is unresolved', () => {
    mocks.connectionIdForFile.mockReturnValue(undefined)
    render(<Transcript />)
    fireEvent.click(screen.getByRole('link'), { metaKey: true })
    expect(mocks.openDetectedFilePath).not.toHaveBeenCalled()
    expect(mocks.error).toHaveBeenCalledWith(expect.stringMatching(/Could not open/))
  })

  it('keeps remote WSL-looking paths literal', async () => {
    mocks.connectionIdForFile.mockReturnValue('ssh-1')
    mocks.fileContext = { ...mocks.fileContext, connectionId: 'ssh-1' }
    render(
      <Transcript
        markdown="Open `/home/repo/result.txt`."
        linkContext={{
          worktreeId: 'wt-1',
          worktreePath: '\\\\wsl.localhost\\Ubuntu\\home\\repo',
          runtimeEnvironmentId: null
        }}
      />
    )
    fireEvent.click(screen.getByRole('link'), { metaKey: true, shiftKey: true })
    await waitFor(() =>
      expect(mocks.download).toHaveBeenCalledWith(
        expect.objectContaining({ connectionId: 'ssh-1' }),
        '/home/repo/result.txt',
        'result.txt',
        'reveal'
      )
    )
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
