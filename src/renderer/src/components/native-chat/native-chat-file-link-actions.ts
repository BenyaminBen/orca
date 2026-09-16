import { toast } from 'sonner'
import { translate } from '@/i18n/i18n'
import { basename } from '@/lib/path'
import { getLocalFileManagerLabel } from '@/lib/local-file-manager-label'
import { downloadRuntimeFile, statRuntimePath } from '@/runtime/runtime-file-client'
import { openDetectedFilePath } from '@/components/terminal-pane/terminal-file-open-routing'
import { isTerminalLinkDirectActivation } from '@/components/terminal-pane/terminal-link-activation'
import type { LinkActionRequest } from '@/components/link-actions/link-action-request'
import type { CommentMarkdownLinkClickHandler } from '@/components/sidebar/CommentMarkdown'
import {
  canDownloadNativeChatFileTarget,
  resolveNativeChatFileOwner,
  type NativeChatFileOwner
} from './native-chat-file-action-owner'
import type { NativeChatFileLinkContext, NativeChatResolvedFileLink } from './native-chat-file-link'

export type NativeChatFileLinkActions = {
  enabled: boolean
  request: (request: LinkActionRequest) => void
  replaceRequest: (current: LinkActionRequest, replacement: LinkActionRequest) => void
  isCurrentRequest: () => boolean
  isCurrentScope: () => boolean
  restoreFocus: () => void
}

type RuntimePathMetadata = Awaited<ReturnType<typeof statRuntimePath>>
type RequestGuard = () => boolean

function showRevealFailed(): void {
  toast.error(
    translate(
      'components.native-chat.file.revealFailed',
      'Could not reveal this file. It may no longer be available.'
    )
  )
}

function showDownloadUnavailable(): void {
  toast.error(
    translate(
      'components.native-chat.file.downloadUnavailable',
      'This path cannot be downloaded from its current host.'
    )
  )
}

async function revealLocalPath(
  target: NativeChatResolvedFileLink,
  context: NativeChatFileLinkContext,
  guard: RequestGuard
): Promise<void> {
  if (!guard()) {
    return
  }
  const owner = resolveNativeChatFileOwner(target, context)
  if (owner.kind !== 'local') {
    showDownloadUnavailable()
    return
  }
  try {
    const result = await window.api.shell.openInFileManager(owner.localPath)
    if (!result.ok) {
      throw new Error(result.reason)
    }
  } catch {
    if (guard()) {
      showRevealFailed()
    }
  }
}

async function downloadAndReveal(
  target: NativeChatResolvedFileLink,
  context: NativeChatFileLinkContext,
  metadataOwner: NativeChatFileOwner,
  metadata: RuntimePathMetadata,
  guard: RequestGuard
): Promise<void> {
  if (!guard()) {
    return
  }
  const owner = resolveNativeChatFileOwner(target, context)
  if (
    owner.key !== metadataOwner.key ||
    !canDownloadNativeChatFileTarget(owner, metadata.isDirectory)
  ) {
    showDownloadUnavailable()
    return
  }
  try {
    if (metadata.isDirectory) {
      if (!owner.directSshConnectionId) {
        showDownloadUnavailable()
        return
      }
      await window.api.fs.downloadFolder({
        dirPath: target.absolutePath,
        connectionId: owner.directSshConnectionId,
        postDownloadAction: 'reveal'
      })
      return
    }
    await downloadRuntimeFile(
      owner.fileContext,
      target.absolutePath,
      basename(target.absolutePath),
      'reveal'
    )
  } catch {
    if (guard()) {
      showRevealFailed()
    }
  }
}

async function resolveRemoteMetadata(
  target: NativeChatResolvedFileLink,
  context: NativeChatFileLinkContext,
  owner: NativeChatFileOwner,
  guard: RequestGuard,
  reportFailure: boolean
): Promise<RuntimePathMetadata | null> {
  try {
    const metadata = await statRuntimePath(owner.fileContext, target.absolutePath)
    if (!guard() || resolveNativeChatFileOwner(target, context).key !== owner.key) {
      return null
    }
    return metadata
  } catch {
    if (reportFailure && guard()) {
      showRevealFailed()
    }
    return null
  }
}

function createOpenInOrcaAction(
  target: NativeChatResolvedFileLink,
  context: NativeChatFileLinkContext
): () => void {
  return () => {
    const owner = resolveNativeChatFileOwner(target, context)
    if (owner.kind === 'unresolved') {
      toast.error(
        translate(
          'components.native-chat.file.openFailed',
          'Could not open this path. It may no longer be available.'
        )
      )
      return
    }
    openDetectedFilePath(target.absolutePath, target.line, target.column, {
      ...context,
      fileContext: owner.fileContext,
      wslDistro: owner.kind === 'local' ? owner.wslDistro : null,
      openDirectoryInOrca: true,
      onOpenError: () =>
        toast.error(
          translate(
            'components.native-chat.file.openFailed',
            'Could not open this path. It may no longer be available.'
          )
        )
    })
  }
}

function remoteDownloadLabel(): string {
  return translate(
    'components.native-chat.file.downloadAndReveal',
    'Download and reveal in {{manager}}',
    { manager: getLocalFileManagerLabel() }
  )
}

export function handleNativeChatFileLink(
  event: Parameters<CommentMarkdownLinkClickHandler>[0],
  target: NativeChatResolvedFileLink,
  context: NativeChatFileLinkContext,
  actions?: NativeChatFileLinkActions
): void {
  event.preventDefault()
  event.stopPropagation()
  const owner = resolveNativeChatFileOwner(target, context)
  const openInOrca = createOpenInOrcaAction(target, context)
  const currentRequest = actions?.isCurrentRequest ?? (() => true)
  const currentScope = actions?.isCurrentScope ?? (() => true)

  if (isTerminalLinkDirectActivation(event)) {
    if (!event.shiftKey) {
      openInOrca()
      return
    }
    if (owner.kind === 'local') {
      void revealLocalPath(target, context, currentRequest)
      return
    }
    if (owner.kind === 'unresolved') {
      showDownloadUnavailable()
      return
    }
    void resolveRemoteMetadata(target, context, owner, currentRequest, true).then((metadata) => {
      if (metadata) {
        void downloadAndReveal(target, context, owner, metadata, currentRequest)
      }
    })
    return
  }
  if (!actions?.enabled || event.button === 1) {
    openInOrca()
    return
  }

  const bounds = event.currentTarget.getBoundingClientRect()
  const request: LinkActionRequest = {
    anchorX: event.detail === 0 ? bounds.left : event.clientX,
    anchorY: event.detail === 0 ? bounds.bottom : event.clientY,
    destination: target.absolutePath,
    kind: 'file',
    restoreFocus: actions.restoreFocus,
    primary: {
      label: translate('components.native-chat.file.openInOrca', 'Open in Orca'),
      run: openInOrca
    },
    ...(owner.kind === 'local'
      ? {
          alternate: {
            label: translate('components.native-chat.file.reveal', 'Reveal in {{manager}}', {
              manager: getLocalFileManagerLabel()
            }),
            external: true,
            run: () => revealLocalPath(target, context, currentScope)
          }
        }
      : {})
  }
  actions.request(request)

  if (owner.kind !== 'ssh' && owner.kind !== 'runtime') {
    return
  }
  void resolveRemoteMetadata(target, context, owner, currentRequest, false).then((metadata) => {
    const currentOwner = resolveNativeChatFileOwner(target, context)
    if (
      !metadata ||
      !currentRequest() ||
      currentOwner.key !== owner.key ||
      !canDownloadNativeChatFileTarget(currentOwner, metadata.isDirectory)
    ) {
      return
    }
    actions.replaceRequest(request, {
      ...request,
      alternate: {
        label: remoteDownloadLabel(),
        external: true,
        run: () => downloadAndReveal(target, context, owner, metadata, currentScope)
      }
    })
  })
}
