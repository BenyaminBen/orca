import { mapTerminalFilePath } from '@/components/terminal-pane/terminal-file-open-routing'
import {
  getRuntimeFileReadScope,
  type RuntimeFileOperationArgs
} from '@/runtime/runtime-file-client'

export type NativeChatImageFileContext = RuntimeFileOperationArgs & {
  /** Renderer-owned interpretation for paths emitted by a local WSL process. */
  localWslDistro?: string | null
}

export function isClientLocalChatImage(context: RuntimeFileOperationArgs): boolean {
  return (
    context.expectedExecutionHostId === 'local' &&
    !getRuntimeFileReadScope(context.settings, context.connectionId)
  )
}

export function resolveNativeChatImageDestination(
  absolutePath: string,
  context: NativeChatImageFileContext
): string {
  return isClientLocalChatImage(context) && context.worktreePath
    ? mapTerminalFilePath(absolutePath, context.worktreePath, context.localWslDistro)
    : absolutePath
}
