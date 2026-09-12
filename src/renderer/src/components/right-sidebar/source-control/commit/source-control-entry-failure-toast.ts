import { useEffect, useRef } from 'react'
import { toast } from 'sonner'
import { translate } from '@/i18n/i18n'
import { readIpcErrorMessage } from '@/lib/ipc-error'
import { useAppStore } from '@/store'

export type SourceControlEntryOperation = 'stage' | 'unstage' | 'discard'

// Why keyed by worktree: the toast outlives a worktree switch, so one global slot would let a
// failure from the repo the user left overwrite — or be mistaken for — one in the repo they entered.
function entryFailureToastId(worktreeId: string | null): string {
  return `source-control-entry-mutation:${worktreeId ?? 'unknown'}`
}

/**
 * Retires the outgoing worktree's failure toast when the active worktree changes.
 *
 * Why on a change rather than in cleanup: the Source Control panel unmounts on every right-sidebar
 * tab switch, and a cleanup would wipe a toast the user stepped away to read.
 */
export function useRetireSourceControlEntryFailureToasts(activeWorktreeId: string | null): void {
  const previousWorktreeIdRef = useRef(activeWorktreeId)
  useEffect(() => {
    if (previousWorktreeIdRef.current === activeWorktreeId) {
      return
    }
    toast.dismiss(entryFailureToastId(previousWorktreeIdRef.current))
    previousWorktreeIdRef.current = activeWorktreeId
  }, [activeWorktreeId])
}

function entryFailureTitle(
  operation: SourceControlEntryOperation,
  filePath: string,
  deleteShaped: boolean
): string {
  switch (operation) {
    case 'stage':
      return translate(
        'auto.components.right.sidebar.SourceControl.entryStageFailed',
        'Failed to stage “{{value0}}”',
        { value0: filePath }
      )
    case 'unstage':
      return translate(
        'auto.components.right.sidebar.SourceControl.entryUnstageFailed',
        'Failed to unstage “{{value0}}”',
        { value0: filePath }
      )
    case 'discard':
      return deleteShaped
        ? translate(
            'auto.components.right.sidebar.SourceControl.entryDeleteFailed',
            'Failed to delete “{{value0}}”',
            { value0: filePath }
          )
        : translate(
            'auto.components.right.sidebar.SourceControl.entryDiscardFailed',
            'Failed to discard “{{value0}}”',
            { value0: filePath }
          )
  }
}

/**
 * Per-row stage/unstage/discard failure. Bulk callers aggregate their own failures into one toast
 * instead — see `reportBulkMutationFailure` and the discard-all summary in `use-discard-confirmation`.
 *
 * A failure belonging to a worktree the user has since left is still reported — silence is the bug
 * this exists to remove — but it names that worktree and offers no action, because every recovery
 * affordance here is bound to the repo the attempt ran against.
 */
export function showSourceControlEntryFailureToast({
  operation,
  filePath,
  deleteShaped = false,
  error,
  worktreeId,
  worktreeName,
  onRetry
}: {
  operation: SourceControlEntryOperation
  filePath: string
  /** True when this discard deletes the file rather than restoring it — see `discard-confirmation`. */
  deleteShaped?: boolean
  error: unknown
  /** The worktree the failed attempt ran against. */
  worktreeId: string | null
  /** Shown only when the toast no longer belongs to the active worktree. */
  worktreeName: string | null
  onRetry?: () => void
}): void {
  const isActiveWorktree = useAppStore.getState().activeWorktreeId === worktreeId
  const title = entryFailureTitle(operation, filePath, deleteShaped)
  const offerRetry = Boolean(onRetry) && isActiveWorktree
  toast.error(
    isActiveWorktree || !worktreeName
      ? title
      : translate(
          'auto.components.right.sidebar.SourceControl.entryFailedInWorkspace',
          '{{value0}} in {{value1}}',
          { value0: title, value1: worktreeName }
        ),
    {
      id: entryFailureToastId(worktreeId),
      description: readIpcErrorMessage(error),
      // Why: sonner's 4s default retires the Retry button before a user reading the path can click it.
      duration: offerRetry ? 10000 : undefined,
      action:
        offerRetry && onRetry
          ? {
              label: translate('auto.components.right.sidebar.SourceControl.286dbda4d6', 'Retry'),
              onClick: onRetry
            }
          : undefined
    }
  )
}
