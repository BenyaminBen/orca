// @vitest-environment happy-dom

import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  toastError: vi.fn(),
  stagePath: vi.fn(),
  unstagePath: vi.fn(),
  discardPath: vi.fn()
}))

vi.mock('sonner', () => ({
  toast: { error: mocks.toastError, dismiss: vi.fn(), message: vi.fn() }
}))
vi.mock('@/lib/connection-context', () => ({ getConnectionId: () => undefined }))
vi.mock('@/components/editor/editor-autosave', () => ({
  notifyEditorExternalFileChange: vi.fn(),
  requestEditorSaveQuiesce: vi.fn(async () => {})
}))
vi.mock('@/runtime/runtime-git-client', () => ({
  stageRuntimeGitPath: (...args: unknown[]) => mocks.stagePath(...args),
  unstageRuntimeGitPath: (...args: unknown[]) => mocks.unstagePath(...args),
  discardRuntimeGitPath: (...args: unknown[]) => mocks.discardPath(...args),
  bulkDiscardRuntimeGitPaths: vi.fn(),
  bulkUnstageRuntimeGitPaths: vi.fn()
}))
vi.mock('@/store', () => ({
  useAppStore: Object.assign(() => undefined, {
    getState: () => ({ settings: { activeRuntimeEnvironmentId: null }, activeWorktreeId: 'wt-1' })
  })
}))

import { useSourceControlDiscardConfirmation } from './use-discard-confirmation'
import { useSourceControlEntryMutations } from './use-entry-mutations'
import type { SourceControlEntryGroups } from '../listing/section-order'

const EMPTY_GROUPS: SourceControlEntryGroups = { unstaged: [], staged: [], untracked: [] }

type ToastOptions = { description?: string; action?: { label: string; onClick: () => void } }

function lastToast(): { title: string; options: ToastOptions } {
  const call = mocks.toastError.mock.calls.at(-1)
  return { title: String(call?.[0]), options: (call?.[1] ?? {}) as ToastOptions }
}

function renderMutations() {
  return renderHook(() =>
    useSourceControlEntryMutations({
      activeRepoSettings: null,
      activeWorktreeId: 'wt-1',
      worktreePath: '/repo',
      refreshActiveGitStatusAfterMutation: async () => {}
    })
  )
}

function renderDiscard(discardSingle: (path: string) => Promise<void>) {
  return renderHook(() =>
    useSourceControlDiscardConfirmation({
      activeRepoSettings: null,
      activeWorktreeId: 'wt-1',
      worktreePath: '/repo',
      grouped: EMPTY_GROUPS,
      isExecutingBulk: false,
      setIsExecutingBulk: () => {},
      clearSelection: () => {},
      discardMany: async () => {},
      discardSingle,
      refreshActiveGitStatusAfterMutation: async () => {}
    })
  )
}

describe('source-control entry mutation failures', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  it('reports a failed stage instead of leaving the row unchanged and silent', async () => {
    mocks.stagePath.mockRejectedValue(new Error('index.lock exists'))
    const { result } = renderMutations()

    await act(async () => {
      await result.current.handleStage('src/app.ts')
    })

    expect(mocks.toastError).toHaveBeenCalledTimes(1)
    expect(lastToast().title).toBe('Failed to stage “src/app.ts”')
    expect(lastToast().options.description).toBe('index.lock exists')
  })

  it('retries the same path from the stage failure toast', async () => {
    mocks.stagePath.mockRejectedValueOnce(new Error('index.lock exists'))
    mocks.stagePath.mockResolvedValueOnce(undefined)
    const { result } = renderMutations()

    await act(async () => {
      await result.current.handleStage('src/app.ts')
    })
    await act(async () => {
      lastToast().options.action?.onClick()
    })

    expect(mocks.stagePath).toHaveBeenCalledTimes(2)
    expect(mocks.stagePath.mock.calls[1]?.[1]).toBe('src/app.ts')
    // Why: the retry succeeded, so no second failure toast.
    expect(mocks.toastError).toHaveBeenCalledTimes(1)
  })

  it('reports a failed unstage', async () => {
    mocks.unstagePath.mockRejectedValue(new Error('bad object'))
    const { result } = renderMutations()

    await act(async () => {
      await result.current.handleUnstage('src/app.ts')
    })

    expect(lastToast().title).toBe('Failed to unstage “src/app.ts”')
  })

  it('leaves a successful stage silent', async () => {
    mocks.stagePath.mockResolvedValue(undefined)
    const { result } = renderMutations()

    await act(async () => {
      await result.current.handleStage('src/app.ts')
    })

    expect(mocks.toastError).not.toHaveBeenCalled()
  })

  it('reports a failed per-row discard — the destructive action must never fail silently', async () => {
    const discardSingle = vi.fn(async () => {
      throw new Error('unable to write file')
    })
    const { result } = renderDiscard(discardSingle)

    await act(async () => {
      result.current.requestDiscardEntry({ path: 'src/app.ts' } as never)
    })
    await act(async () => {
      result.current.confirmPendingDiscard()
    })

    expect(mocks.toastError).toHaveBeenCalledTimes(1)
    expect(lastToast().title).toBe('Failed to discard “src/app.ts”')
    expect(lastToast().options.description).toBe('unable to write file')
  })

  it('sends a discard retry back through the confirmation dialog, never straight to the mutation', async () => {
    // Why this matters: for an untracked or added entry this mutation deletes the file permanently.
    // Every other route to it is gated by the confirmation dialog; Retry must not be the exception.
    const discardSingle = vi
      .fn<(path: string) => Promise<void>>()
      .mockRejectedValueOnce(new Error('unable to write file'))
      .mockResolvedValueOnce(undefined)
    const { result } = renderDiscard(discardSingle)

    await act(async () => {
      result.current.requestDiscardEntry({ path: 'src/app.ts' } as never)
    })
    await act(async () => {
      result.current.confirmPendingDiscard()
    })
    expect(result.current.pendingDiscard).toBeNull()

    await act(async () => {
      lastToast().options.action?.onClick()
    })

    // The dialog is re-armed, and no second destructive call has run.
    expect(result.current.pendingDiscard).toEqual({
      kind: 'entry',
      entry: { path: 'src/app.ts' }
    })
    expect(discardSingle).toHaveBeenCalledTimes(1)

    // Only confirming it a second time re-runs the mutation.
    await act(async () => {
      result.current.confirmPendingDiscard()
    })
    expect(discardSingle).toHaveBeenNthCalledWith(2, 'src/app.ts')
    expect(mocks.toastError).toHaveBeenCalledTimes(1)
  })

  it('says "delete" when the failed discard would have removed an untracked file', async () => {
    const discardSingle = vi
      .fn<(path: string) => Promise<void>>()
      .mockRejectedValue(new Error('unable to write file'))
    const { result } = renderDiscard(discardSingle)

    await act(async () => {
      result.current.requestDiscardEntry({ path: 'new.ts', status: 'untracked' } as never)
    })
    await act(async () => {
      result.current.confirmPendingDiscard()
    })

    expect(lastToast().title).toBe('Failed to delete “new.ts”')
  })
})
