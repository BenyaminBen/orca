import type { ILink } from '@xterm/xterm'
import { describe, expect, it, vi } from 'vitest'
import { mapTerminalFilePath, openDetectedFilePath } from './terminal-link-handlers'
import { createTerminalLinkTestDoubles } from './terminal-link-handlers-test-fixtures'
import { createProviderSetup, makeBufferLine } from './terminal-link-provider-buffer-fixtures'
import { getRevealAncestorDirs } from '../right-sidebar/file-explorer-paths'
import {
  flushAsyncWork,
  flushDoubleRaf,
  installTerminalLinkTestEnvironment,
  setPlatform
} from './terminal-link-handlers-test-harness'

const doubles = createTerminalLinkTestDoubles()
const {
  storeState,
  authorizeExternalPathMock,
  statMock,
  openFileMock,
  setPendingEditorRevealMock,
  runtimeEnvironmentCallMock
} = doubles

vi.mock('@/store', () => ({
  useAppStore: {
    getState: () => storeState
  }
}))

vi.mock('@/lib/language-detect', () => ({
  detectLanguage: (filePath: string) => (filePath.endsWith('.md') ? 'markdown' : 'plaintext')
}))

vi.mock('@/lib/worktree-activation', () => ({
  activateAndRevealWorkspace: vi.fn(),
  activateAndRevealWorktree: vi.fn()
}))

vi.mock('@/lib/connection-context', () => ({
  getConnectionId: vi.fn(() => null)
}))

installTerminalLinkTestEnvironment(doubles)

describe('WSL directory reveal within the owning workspace', () => {
  it.each([
    {
      name: 'canonical share',
      root: String.raw`\\wsl.localhost\Ubuntu\home\repo`,
      link: '/home/repo/src'
    },
    { name: 'legacy share', root: String.raw`\\wsl$\Ubuntu\home\repo`, link: '/home/repo/src' },
    {
      name: 'drive mount share',
      root: String.raw`\\wsl.localhost\Ubuntu\mnt\c\repo`,
      link: '/mnt/c/repo/src'
    },
    { name: 'native drive case', root: String.raw`C:\Repo`, link: '/mnt/c/repo/src' },
    {
      name: 'distro case',
      root: String.raw`\\wsl$\ubuntu\home\repo`,
      link: String.raw`\\wsl.localhost\Ubuntu\home\repo\src`
    }
  ])('reveals an internal folder using the stored root spelling: $name', async ({ root, link }) => {
    setPlatform('Windows')
    statMock.mockResolvedValueOnce({ isDirectory: true })
    openDetectedFilePath(link, null, null, {
      worktreeId: 'wt-1',
      worktreePath: root,
      wslDistro: 'Ubuntu',
      openDirectoryInOrca: true
    })
    await flushAsyncWork()
    const destination = `${root}\\src`
    expect(storeState.revealInExplorer).toHaveBeenCalledWith('wt-1', destination)
    expect(getRevealAncestorDirs(root, destination)).toEqual([])
    expect(doubles.openFilePathMock).not.toHaveBeenCalled()
  })

  it.each([
    { name: 'sibling', root: String.raw`\\wsl$\Ubuntu\home\repo`, link: '/home/repo-other/src' },
    { name: 'outside', root: String.raw`\\wsl$\Ubuntu\home\repo`, link: '/home/other/src' },
    {
      name: 'dot escape',
      root: String.raw`\\wsl$\Ubuntu\home\repo`,
      link: '/home/repo/../other/src'
    },
    {
      name: 'other distro',
      root: String.raw`\\wsl.localhost\Ubuntu\home\repo`,
      link: String.raw`\\wsl.localhost\Debian\home\repo\src`
    },
    {
      name: 'other distro drive',
      root: String.raw`\\wsl.localhost\Ubuntu\mnt\c\repo`,
      link: '//wsl.localhost/Debian/mnt/c/repo/src'
    },
    {
      name: 'Linux case',
      root: String.raw`\\wsl.localhost\Ubuntu\home\Repo`,
      link: '/home/repo/src'
    },
    {
      name: 'uppercase MNT is Linux',
      root: String.raw`\\wsl.localhost\Ubuntu\MNT\c\Repo`,
      link: '/MNT/c/repo/src'
    }
  ])('rejects $name without weakening containment', async ({ root, link }) => {
    setPlatform('Windows')
    statMock.mockResolvedValueOnce({ isDirectory: true })
    openDetectedFilePath(link, null, null, {
      worktreeId: 'wt-1',
      worktreePath: root,
      wslDistro: 'Ubuntu',
      openDirectoryInOrca: true
    })
    await flushAsyncWork()
    expect(storeState.revealInExplorer).not.toHaveBeenCalled()
    expect(doubles.openFilePathMock).not.toHaveBeenCalled()
  })

  it('does not reinterpret a POSIX SSH folder as local WSL', async () => {
    setPlatform('Windows')
    statMock.mockResolvedValueOnce({ isDirectory: true })
    openDetectedFilePath('/home/repo/src', null, null, {
      worktreeId: 'wt-1',
      worktreePath: '/home/repo',
      wslDistro: 'Ubuntu',
      openDirectoryInOrca: true,
      fileContext: {
        worktreeId: 'wt-1',
        worktreePath: '/home/repo',
        connectionId: 'ssh-1',
        settings: undefined
      }
    })
    await flushAsyncWork()
    expect(statMock).toHaveBeenCalledWith({ filePath: '/home/repo/src', connectionId: 'ssh-1' })
    expect(storeState.revealInExplorer).toHaveBeenCalledWith('wt-1', '/home/repo/src')
    expect(authorizeExternalPathMock).not.toHaveBeenCalled()
  })

  it('keeps a paired host folder in its remote execution space', async () => {
    setPlatform('Windows')
    runtimeEnvironmentCallMock.mockResolvedValueOnce({
      id: 'rpc-1',
      ok: true,
      result: { size: 0, isDirectory: true, mtime: 1 },
      _meta: { runtimeId: 'remote-runtime' }
    })
    openDetectedFilePath('/home/repo/src', null, null, {
      worktreeId: 'folder:folder-1',
      worktreePath: '/home/repo',
      wslDistro: 'Ubuntu',
      openDirectoryInOrca: true,
      runtimeEnvironmentId: 'env-1'
    })
    await flushAsyncWork()
    expect(storeState.revealInExplorer).toHaveBeenCalledWith('folder:folder-1', '/home/repo/src')
    expect(statMock).not.toHaveBeenCalled()
    expect(authorizeExternalPathMock).not.toHaveBeenCalled()
    expect(runtimeEnvironmentCallMock).toHaveBeenCalledWith(
      expect.objectContaining({
        selector: 'env-1',
        method: 'files.stat',
        params: expect.objectContaining({ relativePath: 'src' })
      })
    )
  })
})

describe('createFilePathLinkProvider range bounds', () => {
  it.each([
    ['modern', '\\\\wsl.localhost\\Ubuntu\\home\\repo'],
    ['legacy', '\\\\wsl$\\Ubuntu\\home\\repo']
  ])('maps POSIX terminal links for a %s WSL worktree', async (_label, worktreePath) => {
    const mappedPath = '\\\\wsl.localhost\\Ubuntu\\root\\workspace\\myrepo\\README.md'
    vi.mocked(window.api.shell.pathExists).mockImplementation(
      async (pathValue) => pathValue === mappedPath
    )
    const { provider, linkTooltip } = createProviderSetup(
      [makeBufferLine('/root/workspace/myrepo/README.md:5:3')],
      new Map(),
      { worktreePath, wslDistro: 'Ubuntu', startupCwd: '/root/workspace/myrepo' }
    )

    const links = await new Promise<ILink[]>((resolve) => {
      provider.provideLinks(1, (provided) => resolve(provided ?? []))
    })

    expect(links).toHaveLength(1)
    expect(window.api.shell.pathExists).toHaveBeenCalledWith(mappedPath)
    links[0]!.hover?.({} as MouseEvent, links[0]!.text)
    expect(linkTooltip.textContent).toContain(mappedPath)
    links[0]!.activate?.(
      { ctrlKey: true, metaKey: false, shiftKey: false } as MouseEvent,
      links[0]!.text
    )
    await flushAsyncWork()
    await flushDoubleRaf()

    expect(statMock).toHaveBeenCalledWith({ filePath: mappedPath })
    expect(openFileMock).toHaveBeenCalledWith(expect.objectContaining({ filePath: mappedPath }), {
      forceContentReload: true
    })
    expect(setPendingEditorRevealMock).toHaveBeenLastCalledWith({
      filePath: mappedPath,
      fileId: mappedPath,
      line: 5,
      column: 3,
      matchLength: 0
    })
  })

  it('resolves relative POSIX terminal links against the pane cwd before mapping', async () => {
    const mappedPath = '\\\\wsl.localhost\\Ubuntu\\root\\workspace\\myrepo\\README.md'
    vi.mocked(window.api.shell.pathExists).mockImplementation(
      async (pathValue) => pathValue === mappedPath
    )
    const { provider } = createProviderSetup([makeBufferLine('README.md:5')], new Map(), {
      worktreePath: '\\\\wsl.localhost\\Ubuntu\\home\\repo',
      wslDistro: 'Ubuntu',
      startupCwd: '/stale',
      getPaneLinkCwd: () => '/root/workspace/myrepo'
    })

    const links = await new Promise<ILink[]>((resolve) => {
      provider.provideLinks(1, (provided) => resolve(provided ?? []))
    })

    expect(links).toHaveLength(1)
    expect(window.api.shell.pathExists).toHaveBeenCalledWith(mappedPath)
  })

  it('canonicalizes WSL UNC to the Windows backslash form', () => {
    expect(
      mapTerminalFilePath('//wsl.localhost/Ubuntu/root/file.md', '\\\\wsl.localhost\\Ubuntu\\repo')
    ).toBe('\\\\wsl.localhost\\Ubuntu\\root\\file.md')
    expect(
      mapTerminalFilePath(
        '\\\\wsl.localhost\\Ubuntu\\root\\file.md',
        '\\\\wsl.localhost\\Ubuntu\\repo'
      )
    ).toBe('\\\\wsl.localhost\\Ubuntu\\root\\file.md')
    expect(
      mapTerminalFilePath('\\\\server\\share\\file.md', '\\\\wsl.localhost\\Ubuntu\\repo')
    ).toBe('\\\\server\\share\\file.md')
    expect(mapTerminalFilePath('//server/share/file.md', '\\\\wsl.localhost\\Ubuntu\\repo')).toBe(
      '//server/share/file.md'
    )
    expect(mapTerminalFilePath('C:/repo/file.md', '\\\\wsl.localhost\\Ubuntu\\repo')).toBe(
      'C:/repo/file.md'
    )
  })

  it('does not map POSIX paths for a native Windows worktree', () => {
    expect(mapTerminalFilePath('/repo/file.md', 'C:\\repo')).toBe('/repo/file.md')
    expect(mapTerminalFilePath('/mnt/c/repo/file.md', '/Users/a/repo')).toBe('/mnt/c/repo/file.md')
  })

  it('keeps WSL-looking paths literal without a local WSL owner', () => {
    expect(mapTerminalFilePath('//wsl.localhost/Ubuntu/repo/file.md', '/remote/repo')).toBe(
      '//wsl.localhost/Ubuntu/repo/file.md'
    )
    expect(
      mapTerminalFilePath(
        '//wsl.localhost/Ubuntu/repo/file.md',
        '\\\\wsl.localhost\\Ubuntu\\repo',
        null
      )
    ).toBe('//wsl.localhost/Ubuntu/repo/file.md')
  })

  it('maps POSIX paths with the pane WSL distro when the worktree is on a Windows drive', () => {
    expect(mapTerminalFilePath('/home/alice/notes.md', 'C:\\repo', 'Ubuntu')).toBe(
      '\\\\wsl.localhost\\Ubuntu\\home\\alice\\notes.md'
    )
    expect(mapTerminalFilePath('/mnt/c/repo/README.md', 'C:\\repo', 'Ubuntu')).toBe(
      'C:\\repo\\README.md'
    )
  })

  it('routes /mnt drive paths to the native Windows drive for a WSL worktree', () => {
    expect(mapTerminalFilePath('/mnt/c/repo/README.md', '\\\\wsl.localhost\\Ubuntu\\repo')).toBe(
      'C:\\repo\\README.md'
    )
  })

  it('maps POSIX terminal links for a WSL-runtime pane on a Windows-drive worktree', async () => {
    const mappedPath = 'C:\\repo\\src\\main.ts'
    vi.mocked(window.api.shell.pathExists).mockImplementation(
      async (pathValue) => pathValue === mappedPath
    )
    const { provider } = createProviderSetup([makeBufferLine('src/main.ts:5')], new Map(), {
      worktreePath: 'C:\\repo',
      wslDistro: 'Ubuntu',
      startupCwd: '/mnt/c/repo',
      getPaneLinkCwd: () => '/mnt/c/repo'
    })

    const links = await new Promise<ILink[]>((resolve) => {
      provider.provideLinks(1, (provided) => resolve(provided ?? []))
    })

    expect(links).toHaveLength(1)
    expect(window.api.shell.pathExists).toHaveBeenCalledWith(mappedPath)
  })

  it('ignores the pane WSL distro for remote runtime panes', async () => {
    setPlatform('Windows')
    storeState.settings = { activeRuntimeEnvironmentId: 'env-2' }
    runtimeEnvironmentCallMock.mockResolvedValueOnce({
      id: 'rpc-1',
      ok: true,
      result: { size: 1, isDirectory: false, mtime: 1 },
      _meta: { runtimeId: 'remote-runtime' }
    })

    openDetectedFilePath('/home/alice/notes.md', null, null, {
      worktreeId: 'wt-1',
      worktreePath: '/home/alice',
      wslDistro: 'Ubuntu',
      runtimeEnvironmentId: 'env-1'
    })
    await flushAsyncWork()

    expect(authorizeExternalPathMock).not.toHaveBeenCalled()
    expect(statMock).not.toHaveBeenCalled()
    expect(runtimeEnvironmentCallMock).toHaveBeenCalledWith({
      selector: 'env-1',
      method: 'files.stat',
      params: { worktree: 'id:wt-1', relativePath: 'notes.md' },
      timeoutMs: 15_000
    })
    expect(openFileMock).toHaveBeenCalledWith(
      expect.objectContaining({ filePath: '/home/alice/notes.md', runtimeEnvironmentId: 'env-1' }),
      { forceContentReload: true }
    )
  })
})
