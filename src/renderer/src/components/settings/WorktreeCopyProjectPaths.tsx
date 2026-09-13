import { worktreeCopyContext } from './worktree-copy-context'
import { useEffect, useState } from 'react'
import { getRepoExecutionHostId } from '../../../../shared/execution-host'
import { getRepoMainWorktreeId } from '../../../../shared/worktree/id'
import { parseWorktreeIncludeFile } from '../../../../shared/worktree-copy-paths'
import type { Repo } from '../../../../shared/repo-types'
import { readRuntimeDirectory, readRuntimeFileContent } from '../../runtime/runtime-file-client'
import { joinPath } from '../../lib/path'
import { useAppStore } from '../../store'
import { Button } from '../ui/button'
import { translate } from '@/i18n/i18n'

export function WorktreeCopyProjectPaths({ repo }: { repo: Repo }): React.JSX.Element {
  const [result, setResult] = useState<{
    key: string
    paths: string[]
    exists: boolean
    error?: string
  }>()
  const hostId = getRepoExecutionHostId(repo)
  const key = `${hostId}:${repo.id}:${repo.path}`
  const openFile = useAppStore((s) => s.openFile)
  const setActiveWorktree = useAppStore((s) => s.setActiveWorktree)
  const setActiveView = useAppStore((s) => s.setActiveView)
  const worktreeId = getRepoMainWorktreeId(repo)
  const filePath = joinPath(repo.path, '.worktreeinclude')

  useEffect(() => {
    let cancelled = false
    const context = worktreeCopyContext(repo)
    void readRuntimeDirectory(context, repo.path)
      .then(async (entries) => {
        const exists = entries.some((entry) => entry.name === '.worktreeinclude')
        const file = exists
          ? await readRuntimeFileContent({ ...context, filePath, relativePath: '.worktreeinclude' })
          : null
        if (!cancelled) {
          setResult({
            key,
            exists,
            paths: file && !file.isBinary ? parseWorktreeIncludeFile(file.content) : []
          })
        }
      })
      .catch(() => {
        if (!cancelled) {
          setResult({
            key,
            exists: false,
            paths: [],
            error: translate(
              'worktreeCopies.projectUnavailable',
              'Could not read the project list from this host.'
            )
          })
        }
      })
    return () => {
      cancelled = true
    }
  }, [hostId, key, repo, worktreeId, filePath])

  const current = result?.key === key ? result : undefined
  return (
    <div className="space-y-2 rounded-xl border border-border p-4">
      <div className="flex items-center justify-between gap-3">
        <h4 className="text-sm font-medium">
          {translate('worktreeCopies.project', 'From .worktreeinclude')}
        </h4>
        {current?.exists && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setActiveWorktree(worktreeId)
              openFile({
                filePath,
                relativePath: '.worktreeinclude',
                worktreeId,
                language: 'plaintext',
                mode: 'edit'
              })
              setActiveView('terminal')
            }}
          >
            {translate('worktreeCopies.openProject', 'Open file')}
          </Button>
        )}
      </div>
      <p className="text-xs text-muted-foreground">
        {translate(
          'worktreeCopies.projectDescription',
          'Project paths are also copied. Add one ignored file or folder per line; patterns are not supported. Removing a personal entry does not remove a project entry.'
        )}
      </p>
      {current?.error ? (
        <p role="status" className="text-xs text-muted-foreground">
          {current.error}
        </p>
      ) : (
        <p className="break-words font-mono text-xs">
          {current
            ? current.paths.join(', ') ||
              translate('worktreeCopies.noProject', 'No project paths listed.')
            : translate('worktreeCopies.loading', 'Reading project list…')}
        </p>
      )}
    </div>
  )
}
