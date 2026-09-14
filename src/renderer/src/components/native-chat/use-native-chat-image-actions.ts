import { useContext, useState, type MouseEvent } from 'react'
import { translate } from '@/i18n/i18n'
import { useAppStore } from '@/store'
import type { RuntimeFileOperationArgs } from '@/runtime/runtime-file-client'
import {
  closeLinkActionRequest,
  type LinkActionRequest
} from '@/components/link-actions/link-action-request'
import { isTerminalLinkDirectActivation } from '@/components/terminal-pane/terminal-link-activation'
import { isClientLocalChatImage, openChatImageWithDefaultApp } from './native-chat-image-open'
import { NativeChatImageScopeContext } from './native-chat-image-scope'

export function useNativeChatImageActions({
  filePath,
  source,
  label,
  runtimeContext
}: {
  filePath: string | null
  source: string | undefined
  label: string
  runtimeContext: RuntimeFileOperationArgs | null | undefined
}) {
  const [request, setRequest] = useState<LinkActionRequest | null>(null)
  const [previewOpen, setPreviewOpen] = useState(false)
  const scope = useContext(NativeChatImageScopeContext)
  const [previousScope, setPreviousScope] = useState(scope)
  if (scope !== previousScope) {
    setPreviousScope(scope)
    setRequest(null)
    setPreviewOpen(false)
  }
  const openPreview = (): void => setPreviewOpen(true)
  const close = (dismissed?: LinkActionRequest): void =>
    setRequest((current) => closeLinkActionRequest(current, dismissed))
  const onClick = (event: MouseEvent<HTMLButtonElement>): void => {
    event.preventDefault()
    event.stopPropagation()
    const external = () =>
      openChatImageWithDefaultApp({ filePath, source, name: label, context: runtimeContext })
    if (isTerminalLinkDirectActivation(event)) {
      if (event.shiftKey) {
        void external()
      } else {
        openPreview()
      }
      return
    }
    if (useAppStore.getState().settings?.terminalLinkActionPopoverEnabled === false) {
      openPreview()
      return
    }
    const button = event.currentTarget
    const bounds = button.getBoundingClientRect()
    setRequest({
      anchorX: event.detail === 0 ? bounds.left : event.clientX,
      anchorY: event.detail === 0 ? bounds.bottom : event.clientY,
      destination: filePath ?? label,
      kind: 'file',
      restoreFocus: () => button.isConnected && button.focus({ preventScroll: true }),
      primary: {
        label: translate('components.native-chat.image.openInPreview', 'Open in Orca preview'),
        run: openPreview
      },
      alternate: {
        label:
          filePath && runtimeContext && isClientLocalChatImage(runtimeContext)
            ? translate(
                'auto.components.terminal.pane.TerminalLinkActionPopover.openWithDefaultApp',
                'Open with default app'
              )
            : translate(
                'auto.components.terminal.pane.TerminalLinkActionPopover.downloadOpenWithDefaultApp',
                'Download & open with default app'
              ),
        external: true,
        run: external
      }
    })
  }
  return { request, close, onClick, previewOpen, setPreviewOpen }
}
