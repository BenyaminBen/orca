import { describe, expect, it, vi } from 'vitest'
import { getDefaultSettings } from '../../../../shared/constants'
import type { Project } from '../../../../shared/project-types'
import type { Repo } from '../../../../shared/repo-types'
import type { Worktree } from '../../../../shared/worktree/types'
import { folderWorkspaceKey } from '../../../../shared/workspace-scope'
import { resolvePaneWslDistro } from './terminal-pane-wsl-distro'

vi.mock('@/lib/renderer-app-platform', () => ({
  getRendererAppPlatform: (): NodeJS.Platform => 'win32'
}))

vi.mock('@/lib/windows-terminal-capabilities', () => ({
  hasCachedWindowsTerminalCapabilities: () => true,
  getCachedWindowsTerminalCapabilities: () => ({
    wslAvailable: true,
    wslDistros: ['Ubuntu', 'Debian']
  })
}))

type PaneWslDistroState = Parameters<typeof resolvePaneWslDistro>[0]
type WindowsRuntimePreference = NonNullable<Project['localWindowsRuntimePreference']>

const ACTIVE_REPO: Repo = {
  id: 'active-repo',
  path: String.raw`C:\active`,
  displayName: 'Active repo',
  badgeColor: 'blue',
  addedAt: 1
}

function activeProject(preference: WindowsRuntimePreference): Project {
  return {
    id: 'active-project',
    displayName: 'Active project',
    badgeColor: 'blue',
    sourceRepoIds: [ACTIVE_REPO.id],
    localWindowsRuntimePreference: preference,
    createdAt: 1,
    updatedAt: 1
  }
}

function worktree(path: string): Worktree {
  return {
    id: 'active-worktree',
    repoId: ACTIVE_REPO.id,
    projectId: 'active-project',
    path,
    displayName: 'Active worktree',
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
}

function makeState(
  preference: WindowsRuntimePreference,
  targetWorktree?: Worktree
): PaneWslDistroState {
  return {
    activeRepoId: ACTIVE_REPO.id,
    activeWorktreeId: targetWorktree?.id ?? null,
    projects: [activeProject(preference)],
    repos: [ACTIVE_REPO],
    settings: {
      ...getDefaultSettings(String.raw`C:\Users\alice`),
      localWindowsRuntimeDefault: { kind: 'windows-host' }
    },
    worktreesByRepo: targetWorktree ? { [ACTIVE_REPO.id]: [targetWorktree] } : {}
  }
}

describe('resolvePaneWslDistro', () => {
  it.each([
    ['Windows host', { kind: 'windows-host' } as const],
    ['another WSL distro', { kind: 'wsl', distro: 'Debian' } as const]
  ])('uses a folder UNC root instead of the active %s project', (_label, preference) => {
    const state = makeState(preference)
    const folderKey = folderWorkspaceKey('folder-1')

    expect(
      resolvePaneWslDistro(state, folderKey, String.raw`\\wsl.localhost\Ubuntu\home\alice\repo`)
    ).toBe('Ubuntu')
  })

  it('keeps a Windows-drive folder on the host when another project uses WSL', () => {
    const state = makeState({ kind: 'wsl', distro: 'Debian' })

    expect(resolvePaneWslDistro(state, folderWorkspaceKey('folder-1'), String.raw`C:\folder`)).toBe(
      null
    )
  })

  it('keeps project runtime resolution for a real Windows-drive worktree', () => {
    const targetWorktree = worktree(String.raw`C:\active\worktree`)
    const state = makeState({ kind: 'wsl', distro: 'Ubuntu' }, targetWorktree)

    expect(resolvePaneWslDistro(state, targetWorktree.id, targetWorktree.path)).toBe('Ubuntu')
  })
})
