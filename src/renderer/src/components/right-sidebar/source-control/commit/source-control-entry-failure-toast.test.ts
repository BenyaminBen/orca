// @vitest-environment happy-dom

import { beforeEach, describe, expect, it, vi } from 'vitest'

const { toastError, toastDismiss } = vi.hoisted(() => ({
  toastError: vi.fn(),
  toastDismiss: vi.fn()
}))
vi.mock('sonner', () => ({ toast: { error: toastError, dismiss: toastDismiss } }))

const { storeState } = vi.hoisted(() => ({ storeState: { activeWorktreeId: 'wt-1' } }))
vi.mock('@/store', () => ({
  useAppStore: Object.assign(() => undefined, { getState: () => storeState })
}))

import { showSourceControlEntryFailureToast } from './source-control-entry-failure-toast'

type ToastOptions = {
  id?: string
  description?: string
  duration?: number
  action?: { label: string; onClick: () => void }
}

function lastToast(): { title: string; options: ToastOptions } {
  const call = toastError.mock.calls.at(-1)
  return { title: String(call?.[0]), options: (call?.[1] ?? {}) as ToastOptions }
}

function show(overrides: Record<string, unknown> = {}): void {
  showSourceControlEntryFailureToast({
    operation: 'stage',
    filePath: 'src/app.ts',
    error: new Error('index.lock exists'),
    worktreeId: 'wt-1',
    worktreeName: 'feature-a',
    ...overrides
  } as Parameters<typeof showSourceControlEntryFailureToast>[0])
}

describe('showSourceControlEntryFailureToast', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    storeState.activeWorktreeId = 'wt-1'
  })

  it('names the failed operation and the file', () => {
    show()
    expect(lastToast().title).toBe('Failed to stage “src/app.ts”')
    show({ operation: 'unstage' })
    expect(lastToast().title).toBe('Failed to unstage “src/app.ts”')
    show({ operation: 'discard' })
    expect(lastToast().title).toBe('Failed to discard “src/app.ts”')
  })

  it('says "delete" for an entry whose discard removes the file rather than restoring it', () => {
    // Why: untracked and added paths have no HEAD version, so the row button and the confirmation
    // dialog both say "delete" — the failure must not contradict the verb the user pressed.
    show({ operation: 'discard', deleteShaped: true })
    expect(lastToast().title).toBe('Failed to delete “src/app.ts”')
  })

  it('keeps the underlying detail but drops the Electron IPC wrapper', () => {
    show({
      error: new Error("Error invoking remote method 'git:stage': Error: index.lock exists")
    })
    expect(lastToast().options.description).toBe('index.lock exists')
  })

  it('uses one stable slot for entry failures', () => {
    show()
    expect(lastToast().options.id).toBe('source-control-entry-mutation')
    storeState.activeWorktreeId = 'wt-2'
    show({ worktreeId: 'wt-2', worktreeName: 'feature-b' })
    expect(lastToast().options.id).toBe('source-control-entry-mutation')
  })

  it('still reports a failure belonging to a worktree the user has left, naming it', () => {
    // Why: suppressing the ACTION on a worktree mismatch is right; suppressing the REPORT would
    // reintroduce exactly the silent failure this module exists to remove.
    storeState.activeWorktreeId = 'wt-2'
    show({ worktreeId: 'wt-1', worktreeName: 'feature-a', onRetry: vi.fn() })

    expect(toastError).toHaveBeenCalledTimes(1)
    expect(lastToast().title).toBe('Failed to stage “src/app.ts” in feature-a')
    expect(lastToast().options.action).toBeUndefined()
    expect(lastToast().options.duration).toBeUndefined()
  })

  it('offers Retry, and a readable lifetime, only in the worktree that failed', () => {
    const onRetry = vi.fn()
    show({ onRetry })
    expect(lastToast().options.action?.label).toBe('Retry')
    expect(lastToast().options.duration).toBe(10000)
    lastToast().options.action?.onClick()
    expect(onRetry).toHaveBeenCalledTimes(1)
  })

  it('retires a Retry action that became stale after a worktree switch', () => {
    const onRetry = vi.fn()
    show({ onRetry })
    storeState.activeWorktreeId = 'wt-2'

    lastToast().options.action?.onClick()

    expect(onRetry).not.toHaveBeenCalled()
    expect(toastDismiss).toHaveBeenCalledWith('source-control-entry-mutation')
  })

  it('omits the description when the failure carried no readable message', () => {
    show({ error: 'not an Error' })
    expect(lastToast().options.description).toBeUndefined()
  })
})
