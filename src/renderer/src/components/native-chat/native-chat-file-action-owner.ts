import { getConnectionIdForFile } from '@/lib/connection-context'
import {
  getRuntimeFileReadScope,
  type RuntimeFileOperationArgs
} from '@/runtime/runtime-file-client'
import { useAppStore } from '@/store'
import {
  getTerminalFileContext,
  mapTerminalFilePath
} from '@/components/terminal-pane/terminal-file-open-routing'
import { resolvePaneWslDistro } from '@/components/terminal-pane/terminal-pane-wsl-distro'
import { shouldShowRemoteDownloadAction } from '@/components/right-sidebar/file-explorer-row-action-visibility'
import type { NativeChatFileLinkContext, NativeChatResolvedFileLink } from './native-chat-file-link'

export type NativeChatFileOwner = {
  kind: 'local' | 'ssh' | 'runtime' | 'unresolved'
  key: string
  fileContext: RuntimeFileOperationArgs
  localPath: string
  directSshConnectionId: string | null
  supportsFolderDownload: boolean
  wslDistro: string | null
}

export function resolveNativeChatFileOwner(
  target: NativeChatResolvedFileLink,
  context: NativeChatFileLinkContext
): NativeChatFileOwner {
  const connectionId = getConnectionIdForFile(context.worktreeId, target.absolutePath)
  const baseFileContext = getTerminalFileContext(
    context.worktreeId,
    context.worktreePath,
    context.runtimeEnvironmentId,
    target.absolutePath
  )
  const fileContext = {
    ...baseFileContext,
    connectionId: typeof connectionId === 'string' ? connectionId : undefined
  }
  const remoteScope = getRuntimeFileReadScope(fileContext.settings, fileContext.connectionId)
  if (remoteScope?.startsWith('runtime:')) {
    return {
      kind: 'runtime',
      key: remoteScope,
      fileContext,
      localPath: target.absolutePath,
      directSshConnectionId: null,
      supportsFolderDownload: false,
      wslDistro: null
    }
  }
  if (typeof connectionId === 'string') {
    return {
      kind: 'ssh',
      key: `ssh:${connectionId}`,
      fileContext,
      localPath: target.absolutePath,
      directSshConnectionId: connectionId,
      supportsFolderDownload:
        useAppStore.getState().sshConnectionStates.get(connectionId)?.supportsFolderDownload ===
        true,
      wslDistro: null
    }
  }
  if (connectionId === undefined) {
    return {
      kind: 'unresolved',
      key: 'unresolved',
      fileContext,
      localPath: target.absolutePath,
      directSshConnectionId: null,
      supportsFolderDownload: false,
      wslDistro: null
    }
  }
  const wslDistro = resolvePaneWslDistro(
    useAppStore.getState(),
    context.worktreeId,
    context.worktreePath
  )
  return {
    kind: 'local',
    key: 'local',
    fileContext,
    localPath: mapTerminalFilePath(target.absolutePath, context.worktreePath, wslDistro),
    directSshConnectionId: null,
    supportsFolderDownload: false,
    wslDistro
  }
}

export function canDownloadNativeChatFileTarget(
  owner: NativeChatFileOwner,
  isDirectory: boolean
): boolean {
  return shouldShowRemoteDownloadAction(
    { isDirectory },
    owner.directSshConnectionId,
    owner.kind === 'runtime' ? owner.fileContext : null,
    owner.supportsFolderDownload
  )
}
