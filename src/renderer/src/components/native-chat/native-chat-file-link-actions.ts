import { toast } from 'sonner'
import { translate } from '@/i18n/i18n'
import { basename } from '@/lib/path'
import { getLocalFileManagerLabel } from '@/lib/local-file-manager-label'
import { getRuntimeFileReadScope, downloadRuntimeFile } from '@/runtime/runtime-file-client'
import {
  getTerminalFileContext,
  openDetectedFilePath
} from '@/components/terminal-pane/terminal-file-open-routing'
import { isTerminalLinkDirectActivation } from '@/components/terminal-pane/terminal-link-activation'
import type { LinkActionRequest } from '@/components/link-actions/link-action-request'
import type { CommentMarkdownLinkClickHandler } from '@/components/sidebar/CommentMarkdown'
import type { NativeChatFileLinkContext, NativeChatResolvedFileLink } from './native-chat-file-link'

export type NativeChatFileLinkActions = {
  enabled: boolean
  request: (request: LinkActionRequest) => void
  restoreFocus: () => void
}

export function handleNativeChatFileLink(
  event: Parameters<CommentMarkdownLinkClickHandler>[0],
  target: NativeChatResolvedFileLink,
  context: NativeChatFileLinkContext,
  actions?: NativeChatFileLinkActions
): void {
  event.preventDefault()
  event.stopPropagation()
  const fileContext = getTerminalFileContext(
    context.worktreeId,
    context.worktreePath,
    context.runtimeEnvironmentId
  )
  const remote = Boolean(getRuntimeFileReadScope(fileContext.settings, fileContext.connectionId))
  const openInOrca = (): void =>
    openDetectedFilePath(target.absolutePath, target.line, target.column, {
      ...context,
      fileContext,
      openDirectoryInOrca: true,
      onOpenError: () =>
        toast.error(
          translate(
            'components.native-chat.file.openFailed',
            'Could not open this path. It may no longer be available.'
          )
        )
    })
  const reveal = async (): Promise<void> => {
    try {
      const path = target.absolutePath
      if (remote) {
        await downloadRuntimeFile(fileContext, path, basename(path), 'reveal')
        return
      }
      const result = await window.api.shell.openInFileManager(path)
      if (!result.ok) {
        throw new Error(result.reason)
      }
    } catch {
      toast.error(
        translate(
          'components.native-chat.file.revealFailed',
          'Could not reveal this file. It may no longer be available.'
        )
      )
    }
  }
  if (isTerminalLinkDirectActivation(event)) {
    if (event.shiftKey) {
      void reveal()
    } else {
      openInOrca()
    }
    return
  }
  if (!actions?.enabled || event.button === 1) {
    openInOrca()
    return
  }
  const bounds = event.currentTarget.getBoundingClientRect()
  actions.request({
    anchorX: event.detail === 0 ? bounds.left : event.clientX,
    anchorY: event.detail === 0 ? bounds.bottom : event.clientY,
    destination: target.absolutePath,
    kind: 'file',
    restoreFocus: actions.restoreFocus,
    primary: {
      label: translate('components.native-chat.file.openInOrca', 'Open in Orca'),
      run: openInOrca
    },
    alternate: {
      label: remote
        ? translate(
            'components.native-chat.file.downloadAndReveal',
            'Download and reveal in {{manager}}',
            { manager: getLocalFileManagerLabel() }
          )
        : translate('components.native-chat.file.reveal', 'Reveal in {{manager}}', {
            manager: getLocalFileManagerLabel()
          }),
      external: true,
      run: reveal
    }
  })
}
