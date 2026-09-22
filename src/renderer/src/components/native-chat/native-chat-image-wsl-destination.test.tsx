// @vitest-environment happy-dom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getDefaultSettings } from '../../../../shared/constants'
import type { FolderWorkspace } from '../../../../shared/folder-workspace-types'
import type { Project } from '../../../../shared/project-types'
import type { Repo } from '../../../../shared/repo-types'
import type { TerminalTab } from '../../../../shared/terminal-tab-types'
import type {
  DetectedWorktree,
  DetectedWorktreeListResult,
  Worktree
} from '../../../../shared/worktree/types'
import type { ExecutionHostId } from '../../../../shared/execution-host'
import { folderWorkspaceKey } from '../../../../shared/workspace-scope'
import { TooltipProvider } from '@/components/ui/tooltip'
import { resetLocalImageSrcStateForTests } from '@/components/editor/useLocalImageSrc'
import { findKnownWorktreeById } from '@/store/slices/worktrees/listing/detected-worktree-meta'
import { NativeChatImageAttachments } from './NativeChatImageAttachments'
import {
  resolveNativeChatImageDestination,
  type NativeChatImageFileContext
} from './native-chat-image-destination'
import { useNativeChatImageRuntimeContext } from './native-chat-image-runtime-context'

const worktreePath = String.raw`\\wsl.localhost\Ubuntu\home\repo`
const imagePath = '/home/repo/image.png'

const worktree: Worktree = {
  id: 'worktree-1',
  repoId: 'repo-1',
  projectId: 'project-1',
  hostId: 'local',
  path: worktreePath,
  displayName: 'Worktree',
  comment: '',
  linkedIssue: null,
  linkedPR: null,
  linkedLinearIssue: null,
  isArchived: false,
  isUnread: false,
  isPinned: false,
  sortOrder: 0,
  lastActivityAt: 1,
  head: 'abc123',
  branch: 'main',
  isBare: false,
  isMainWorktree: true
}
const repo: Repo = {
  id: 'repo-1',
  path: worktreePath,
  displayName: 'Repo',
  badgeColor: 'blue',
  addedAt: 1
}
const project: Project = {
  id: 'project-1',
  displayName: 'Project',
  badgeColor: 'blue',
  sourceRepoIds: [repo.id],
  createdAt: 1,
  updatedAt: 1
}
const activeRepo: Repo = {
  id: 'active-repo',
  path: String.raw`C:\active`,
  displayName: 'Active repo',
  badgeColor: 'blue',
  addedAt: 1
}
const tab: TerminalTab = {
  id: 'tab-1',
  ptyId: null,
  worktreeId: worktree.id,
  title: 'Chat',
  customTitle: null,
  color: null,
  sortOrder: 0,
  createdAt: 1
}
const folderWorkspaces: FolderWorkspace[] = []
const tabsByWorktree: Record<string, TerminalTab[]> = { [worktree.id]: [tab] }
const worktreesByRepo: Record<string, Worktree[]> = { [repo.id]: [worktree] }
const detectedWorktreesByRepo: Record<string, DetectedWorktreeListResult> = {}

const mocks = vi.hoisted(() => ({
  readFile: vi.fn(),
  authorizeExternalPath: vi.fn(),
  openFilePath: vi.fn(),
  downloadAndOpenRemoteTerminalFile: vi.fn(),
  openSettingsPage: vi.fn(),
  openSettingsTarget: vi.fn()
}))

function getKnownWorktreeById(
  worktreeId: string,
  executionHostId?: ExecutionHostId
): Worktree | DetectedWorktree | undefined {
  return findKnownWorktreeById(storeState, worktreeId, executionHostId)
}

const storeState = {
  activeRepoId: repo.id,
  activeWorktreeId: worktree.id,
  activeWorkspaceExecutionHostId: 'local',
  detectedWorktreesByRepo,
  folderWorkspaces,
  getKnownWorktreeById,
  projectGroups: [],
  projects: [project],
  removedRuntimeEnvironmentIds: new Set<string>(),
  repos: [repo],
  restoredRuntimeHostIdByWorkspaceSessionKey: {},
  runtimeEnvironmentCatalogHydrated: true,
  runtimeEnvironments: [],
  settings: {
    ...getDefaultSettings(String.raw`C:\Users\alice`),
    activeRuntimeEnvironmentId: null,
    terminalLinkActionPopoverEnabled: true
  },
  sshConnectionStates: new Map(),
  sshStateByEnvironment: {},
  tabsByWorktree,
  unifiedTabsByWorktree: {},
  worktreesByRepo,
  openSettingsPage: mocks.openSettingsPage,
  openSettingsTarget: mocks.openSettingsTarget
}

vi.mock('@/store', () => ({
  useAppStore: Object.assign(
    (selector: (state: typeof storeState) => unknown) => selector(storeState),
    { getState: () => storeState }
  )
}))
vi.mock('@/lib/renderer-app-platform', () => ({
  getRendererAppPlatform: (): NodeJS.Platform => 'win32'
}))
vi.mock('@/lib/windows-terminal-capabilities', () => ({
  hasCachedWindowsTerminalCapabilities: () => true,
  getCachedWindowsTerminalCapabilities: () => ({
    wslAvailable: true,
    wslDistros: ['Ubuntu']
  })
}))
vi.mock('@/i18n/i18n', () => ({ translate: (_key: string, fallback: string) => fallback }))
vi.mock('@/components/terminal-pane/terminal-remote-file-download-open', () => ({
  downloadAndOpenRemoteTerminalFile: mocks.downloadAndOpenRemoteTerminalFile
}))

function WslImageMessage({
  path = imagePath,
  stateVersion = 1
}: {
  path?: string
  stateVersion?: number
}): React.JSX.Element {
  const context = useNativeChatImageRuntimeContext(tab.id)
  return (
    <div data-state-version={stateVersion}>
      <TooltipProvider>
        <NativeChatImageAttachments
          blocks={[{ type: 'image-ref', path }]}
          runtimeContext={context}
          compact={false}
        />
      </TooltipProvider>
    </div>
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  resetLocalImageSrcStateForTests()
  vi.stubGlobal('IntersectionObserver', undefined)
  vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:image')
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
  vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue('Macintosh')
  mocks.readFile.mockResolvedValue({ content: 'AA==', isBinary: true, mimeType: 'image/png' })
  mocks.authorizeExternalPath.mockResolvedValue(undefined)
  mocks.openFilePath.mockResolvedValue(true)
  tab.worktreeId = worktree.id
  for (const worktreeId of Object.keys(tabsByWorktree)) {
    delete tabsByWorktree[worktreeId]
  }
  tabsByWorktree[worktree.id] = [tab]
  worktree.path = worktreePath
  repo.path = worktreePath
  delete project.localWindowsRuntimePreference
  storeState.projects = [project]
  storeState.repos = [repo]
  storeState.activeRepoId = repo.id
  storeState.activeWorktreeId = worktree.id
  storeState.worktreesByRepo = { [repo.id]: [worktree] }
  storeState.detectedWorktreesByRepo = {}
  folderWorkspaces.length = 0
  Object.defineProperty(window, 'api', {
    configurable: true,
    value: {
      fs: { readFile: mocks.readFile, authorizeExternalPath: mocks.authorizeExternalPath },
      shell: { openFilePath: mocks.openFilePath }
    }
  })
})

async function expectImageDestinations(
  path: string,
  previewPath: string,
  openPath: string
): Promise<void> {
  render(<WslImageMessage path={path} />)
  await screen.findByRole('img', { name: 'image.png' })
  expect(mocks.authorizeExternalPath).toHaveBeenCalledWith({ targetPath: previewPath })
  expect(mocks.readFile).toHaveBeenCalledWith({
    filePath: previewPath,
    connectionId: undefined
  })
  fireEvent.click(screen.getByRole('button', { name: 'View image: image.png' }))
  fireEvent.click(await screen.findByRole('button', { name: /Open with default app/ }))
  await waitFor(() => expect(mocks.openFilePath).toHaveBeenCalledWith(openPath))
}

afterEach(() => {
  cleanup()
  resetLocalImageSrcStateForTests()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('native chat WSL image destination', () => {
  it.each([
    [
      'SSH',
      (): NativeChatImageFileContext => ({
        settings: { ...storeState.settings, activeRuntimeEnvironmentId: null },
        worktreeId: 'remote-worktree',
        worktreePath: String.raw`\\wsl.localhost\Ubuntu\home\remote`,
        connectionId: 'remote',
        expectedExecutionHostId: 'ssh:remote',
        localWslDistro: 'Ubuntu'
      })
    ],
    [
      'paired runtime',
      (): NativeChatImageFileContext => ({
        settings: { ...storeState.settings, activeRuntimeEnvironmentId: 'runtime-1' },
        worktreeId: 'remote-worktree',
        worktreePath: String.raw`\\wsl.localhost\Ubuntu\home\remote`,
        expectedExecutionHostId: 'local',
        localWslDistro: 'Ubuntu'
      })
    ]
  ])('keeps a POSIX image literal for a %s owner with a WSL-looking root', (_label, context) => {
    expect(resolveNativeChatImageDestination('/home/remote/image.png', context())).toBe(
      '/home/remote/image.png'
    )
  })

  it('uses the owning distro for preview and external open', async () => {
    await expectImageDestinations(
      imagePath,
      '//wsl.localhost/Ubuntu/home/repo/image.png',
      String.raw`\\wsl.localhost\Ubuntu\home\repo\image.png`
    )
  })

  it('uses the project distro for a Windows-drive worktree', async () => {
    worktree.path = String.raw`C:\repo`
    repo.path = worktree.path
    project.localWindowsRuntimePreference = { kind: 'wsl', distro: 'Ubuntu' }

    await expectImageDestinations(
      '/mnt/c/repo/image.png',
      'C:/repo/image.png',
      String.raw`C:\repo\image.png`
    )
  })

  it.each([
    ['Windows-drive', String.raw`C:\repo`, { kind: 'windows-host' } as const],
    ['Windows-drive', String.raw`C:\repo`, { kind: 'wsl', distro: 'Debian' } as const],
    ['UNC', String.raw`\\wsl.localhost\Ubuntu\home\repo`, { kind: 'windows-host' } as const],
    [
      'UNC',
      String.raw`\\wsl.localhost\Ubuntu\home\repo`,
      { kind: 'wsl', distro: 'Debian' } as const
    ]
  ])(
    'uses the detected-only %s worktree project instead of the active project',
    async (_pathKind, retainedPath, activePreference) => {
      worktree.path = retainedPath
      repo.path = retainedPath
      storeState.projects = [
        { ...project, localWindowsRuntimePreference: { kind: 'wsl', distro: 'Ubuntu' } },
        {
          id: 'active-project',
          displayName: 'Active project',
          badgeColor: 'blue',
          sourceRepoIds: [activeRepo.id],
          localWindowsRuntimePreference: activePreference,
          createdAt: 1,
          updatedAt: 1
        }
      ]
      storeState.repos = [repo, activeRepo]
      storeState.activeRepoId = activeRepo.id
      storeState.activeWorktreeId = 'active-worktree'
      storeState.worktreesByRepo = {}
      storeState.detectedWorktreesByRepo = {
        [repo.id]: {
          repoId: repo.id,
          authoritative: true,
          source: 'git',
          worktrees: [
            {
              ...worktree,
              ownership: 'external',
              selectedCheckout: false,
              visible: false
            }
          ]
        }
      }

      await expectImageDestinations(
        imagePath,
        '//wsl.localhost/Ubuntu/home/repo/image.png',
        String.raw`\\wsl.localhost\Ubuntu\home\repo\image.png`
      )
    }
  )

  it.each([
    ['Windows host', { kind: 'windows-host' } as const],
    ['another WSL distro', { kind: 'wsl', distro: 'Debian' } as const]
  ])('uses a folder UNC root instead of the active %s project', async (_label, preference) => {
    const folderKey = folderWorkspaceKey('folder-1')
    tab.worktreeId = folderKey
    delete tabsByWorktree[worktree.id]
    tabsByWorktree[folderKey] = [tab]
    project.localWindowsRuntimePreference = preference
    folderWorkspaces.push({
      id: 'folder-1',
      projectGroupId: 'group-1',
      name: 'Folder',
      folderPath: String.raw`\\wsl.localhost\Ubuntu\home\folder`,
      executionHostId: 'local',
      linkedTask: null,
      comment: '',
      isArchived: false,
      isUnread: false,
      isPinned: false,
      sortOrder: 0,
      lastActivityAt: 1,
      createdAt: 1,
      updatedAt: 1
    })

    await expectImageDestinations(
      '/home/folder/image.png',
      '//wsl.localhost/Ubuntu/home/folder/image.png',
      String.raw`\\wsl.localhost\Ubuntu\home\folder\image.png`
    )
  })

  it('retires the preview and action when the owning project distro changes', async () => {
    worktree.path = String.raw`C:\repo`
    repo.path = worktree.path
    storeState.projects = [
      { ...project, localWindowsRuntimePreference: { kind: 'wsl', distro: 'Ubuntu' } }
    ]
    const view = render(<WslImageMessage stateVersion={1} />)
    await screen.findByRole('img', { name: 'image.png' })
    expect(mocks.readFile).toHaveBeenCalledWith({
      filePath: '//wsl.localhost/Ubuntu/home/repo/image.png',
      connectionId: undefined
    })
    fireEvent.click(screen.getByRole('button', { name: 'View image: image.png' }))
    expect(await screen.findByRole('button', { name: /Open with default app/ })).toBeTruthy()

    storeState.projects = [
      { ...project, localWindowsRuntimePreference: { kind: 'wsl', distro: 'Debian' } }
    ]
    view.rerender(<WslImageMessage stateVersion={2} />)
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: /Open with default app/ })).toBeNull()
    )
    await waitFor(() =>
      expect(mocks.readFile).toHaveBeenCalledWith({
        filePath: '//wsl.localhost/Debian/home/repo/image.png',
        connectionId: undefined
      })
    )
    fireEvent.click(screen.getByRole('button', { name: 'View image: image.png' }))
    fireEvent.click(await screen.findByRole('button', { name: /Open with default app/ }))
    await waitFor(() =>
      expect(mocks.openFilePath).toHaveBeenCalledWith(
        String.raw`\\wsl.localhost\Debian\home\repo\image.png`
      )
    )
  })
})
