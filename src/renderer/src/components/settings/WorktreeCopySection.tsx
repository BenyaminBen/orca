import { readRuntimeDirectory } from '../../runtime/runtime-file-client'
import { getRuntimeGitIgnoredPaths } from '../../runtime/runtime-git-status-client'
import { worktreeCopyContext } from './worktree-copy-context'
import { WorktreeLegacyPaths } from './WorktreeLegacyPaths'
import {
  isWorktreeCopyPath,
  parseWorktreeIncludeFile
} from '../../../../shared/worktree-copy-paths'
import { WorktreeCopyProjectPaths } from './WorktreeCopyProjectPaths'
import { useEffect, useMemo, useState } from 'react'
import { Folder, Plus, X } from 'lucide-react'
import type { Repo } from '../../../../shared/repo-types'
import { Button } from '../ui/button'
import { Command, CommandEmpty, CommandInput, CommandItem, CommandList } from '../ui/command'
import { Popover, PopoverContent, PopoverTrigger } from '../ui/popover'
import { cn } from '@/lib/utils'
import { getFileTypeIcon } from '@/lib/file-type-icons'
import { SearchableSetting } from './SearchableSetting'
import {
  getWorktreeSymlinkPathFilterState,
  type WorktreeSymlinkPathSuggestion
} from './worktree-symlink-path-filter'
import { translate } from '@/i18n/i18n'
import { getRepoExecutionHostId } from '../../../../shared/execution-host'

type WorktreeCopySectionProps = {
  repo: Repo
  updateRepo: (repoId: string, updates: Partial<Repo>) => void | Promise<boolean>
}

type DirectorySuggestionState = {
  requestKey: string
  entries: WorktreeSymlinkPathSuggestion[]
}

const EMPTY_WORKTREE_COPY_PATHS: readonly string[] = []

export function WorktreeCopySection({
  repo,
  updateRepo
}: WorktreeCopySectionProps): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')

  const paths = repo.worktreeCopyPaths ?? EMPTY_WORKTREE_COPY_PATHS
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const directorySuggestionKey = `${getRepoExecutionHostId(repo)}:${repo.id}:${repo.path}`
  const [directorySuggestions, setDirectorySuggestions] = useState<DirectorySuggestionState>(
    () => ({
      requestKey: directorySuggestionKey,
      entries: []
    })
  )

  useEffect(() => {
    let cancelled = false
    const context = worktreeCopyContext(repo)
    void readRuntimeDirectory(context, repo.path)
      .then(async (list) => {
        const ignored = new Set(
          await getRuntimeGitIgnoredPaths(
            context,
            list.map((entry) => entry.name)
          )
        )
        if (cancelled) {
          return
        }
        setDirectorySuggestions({
          requestKey: directorySuggestionKey,
          entries: list
            .filter((entry) => ignored.has(entry.name))
            .map((entry) => ({ name: entry.name, isDirectory: entry.isDirectory }))
        })
      })
      .catch(() => {
        // Non-fatal: without entries the combobox still works as a free-text
        // input — the user can type any path and commit it.
      })
    return () => {
      cancelled = true
    }
  }, [repo, directorySuggestionKey])

  const { queryTrimmed, filtered, showLiteralItem } = useMemo(() => {
    const suggestionEntries =
      directorySuggestions.requestKey === directorySuggestionKey ? directorySuggestions.entries : []
    return getWorktreeSymlinkPathFilterState({
      query,
      suggestions: suggestionEntries,
      existingPaths: paths
    })
  }, [query, paths, directorySuggestionKey, directorySuggestions])

  const commit = async (rawName: string): Promise<void> => {
    const trimmed = parseWorktreeIncludeFile(rawName)[0] ?? ''
    if (!isWorktreeCopyPath(trimmed)) {
      setError(
        translate(
          'worktreeCopies.invalid',
          'Use a literal path inside this repository, such as .env. Patterns and parent paths are not supported.'
        )
      )
      return
    }
    setError('')
    if (!trimmed || paths.includes(trimmed)) {
      setQuery('')
      return
    }
    setSaving(true)
    try {
      const ignored = await getRuntimeGitIgnoredPaths(worktreeCopyContext(repo), [trimmed])
      if (!ignored.includes(trimmed)) {
        setError(
          translate(
            'worktreeCopies.notIgnored',
            'Choose a file or folder ignored by Git. Tracked files already come from the chosen branch.'
          )
        )
        return
      }
      if ((await updateRepo(repo.id, { worktreeCopyPaths: [...paths, trimmed] })) === false) {
        setError(
          translate(
            'worktreeCopies.saveFailed',
            'Could not save these paths. Check the connection and update the Orca host if needed.'
          )
        )
        return
      }
    } catch {
      setError(
        translate(
          'worktreeCopies.validationFailed',
          'Could not validate this path on its host. Check the connection and try again.'
        )
      )
      return
    } finally {
      setSaving(false)
    }
    setQuery('')
    setOpen(false)
  }

  const handleRemove = (path: string): void => {
    updateRepo(repo.id, { worktreeCopyPaths: paths.filter((p) => p !== path) })
  }

  return (
    <SearchableSetting
      title={translate('worktreeCopies.title', 'Files to copy')}
      description={translate(
        'worktreeCopies.description',
        'Personal files to copy for this repository and host, in addition to .worktreeinclude.'
      )}
      keywords={[
        repo.displayName,
        'apfs',
        'clone',
        'copy',
        'symlink',
        'symlinks',
        'worktree',
        'link',
        'shared',
        'env',
        'node_modules'
      ]}
      className="space-y-4"
    >
      <div className="flex items-start justify-between gap-4">
        <div className="space-y-1">
          <h3 className="text-sm font-semibold">
            {translate('worktreeCopies.title', 'Files to copy')}
          </h3>
          <p className="text-xs text-muted-foreground">
            {translate(
              'worktreeCopies.explanation',
              'For this repository and host only. New worktrees get their own copies of these ignored files and folders from the primary checkout. Fast copying is automatic; a failed copy never becomes a shared link.'
            )}
          </p>
        </div>
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger asChild>
            <Button type="button" variant="outline" size="sm" disabled={saving}>
              <Plus className="size-3.5" />
              {translate('worktreeCopies.add', 'Add path')}
            </Button>
          </PopoverTrigger>
          <PopoverContent align="end" className="w-72 p-0">
            <Command shouldFilter={false}>
              <CommandInput
                placeholder={translate(
                  'auto.components.settings.WorktreeSymlinksSection.4cd2a4c077',
                  'Type a path (e.g. .env or node_modules)…'
                )}
                value={query}
                onValueChange={setQuery}
              />
              <CommandList>
                <CommandEmpty>
                  {translate(
                    'auto.components.settings.WorktreeSymlinksSection.ab40b8a5f1',
                    'No matches. Keep typing to add a custom path.'
                  )}
                </CommandEmpty>
                {showLiteralItem ? (
                  <CommandItem
                    value={`__literal__:${queryTrimmed}`}
                    onSelect={() => commit(queryTrimmed)}
                    className="items-center gap-2 px-3 py-2"
                  >
                    <Plus className="size-3.5 text-muted-foreground" />
                    <span className="text-xs">
                      {translate(
                        'auto.components.settings.WorktreeSymlinksSection.b2429aeb31',
                        'Add'
                      )}{' '}
                      <code className="rounded bg-muted px-1 py-0.5 text-[11px]">
                        {queryTrimmed}
                      </code>
                    </span>
                  </CommandItem>
                ) : null}
                {filtered.map((entry) => {
                  const alreadyAdded = paths.includes(entry.name)
                  const FileIcon = getFileTypeIcon(entry.name)
                  return (
                    <CommandItem
                      key={entry.name}
                      value={entry.name}
                      disabled={alreadyAdded}
                      onSelect={() => commit(entry.name)}
                      className={cn('items-center gap-2 px-3 py-2', alreadyAdded && 'opacity-50')}
                    >
                      {entry.isDirectory ? (
                        <Folder className="size-3.5 text-muted-foreground" />
                      ) : (
                        <FileIcon className="size-3.5 text-muted-foreground" />
                      )}
                      <span className="truncate text-xs">{entry.name}</span>
                      {alreadyAdded ? (
                        <span className="ml-auto text-[10px] uppercase tracking-wide text-muted-foreground">
                          {translate(
                            'auto.components.settings.WorktreeSymlinksSection.ea06227efa',
                            'added'
                          )}
                        </span>
                      ) : null}
                    </CommandItem>
                  )
                })}
              </CommandList>
            </Command>
          </PopoverContent>
        </Popover>
      </div>

      {error && (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      )}
      <p className="break-all text-xs text-muted-foreground">
        {translate('worktreeCopies.source', 'Source: {{path}}', { path: repo.path })}
      </p>
      {paths.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border/60 bg-background/60 px-4 py-6 text-sm text-muted-foreground">
          {translate(
            'worktreeCopies.empty',
            'No personal paths added. Project paths in .worktreeinclude still apply.'
          )}
        </div>
      ) : (
        <div className="space-y-2 rounded-xl border border-border p-4">
          <h4 className="text-sm font-medium">
            {translate('worktreeCopies.personal', 'Your additions')}
          </h4>
          <div className="flex flex-wrap gap-2">
            {paths.map((path) => (
              <span
                key={path}
                className="inline-flex max-w-full items-center gap-2 rounded-md bg-muted px-2 py-1 font-mono text-xs"
              >
                <span className="truncate">{path}</span>
                <Button
                  size="icon-xs"
                  variant="ghost"
                  onClick={() => handleRemove(path)}
                  aria-label={translate('worktreeCopies.remove', 'Remove {{path}}', { path })}
                >
                  <X className="size-3" />
                </Button>
              </span>
            ))}
          </div>
        </div>
      )}

      <WorktreeCopyProjectPaths repo={repo} />
      <p className="text-xs text-muted-foreground">
        {translate(
          'worktreeCopies.limits',
          'Copies are limited to 2 GiB of ordinary copying and 50,000 entries. Use setup to install dependencies. Sharing is an explicit choice in orca.yaml. Links inside copied folders keep their targets.'
        )}
      </p>
      <WorktreeLegacyPaths repo={repo} updateRepo={updateRepo} />
    </SearchableSetting>
  )
}
