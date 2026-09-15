import { useEffect, useRef, useState } from 'react'
import { Image as ImageIcon } from 'lucide-react'
import { translate } from '@/i18n/i18n'
import { basename, joinPath } from '@/lib/path'
import { cn } from '@/lib/utils'
import { LinkActionPopover } from '@/components/link-actions/LinkActionPopover'
import { resolveImageAbsolutePath } from '@/components/editor/markdown-preview-links'
import type { NativeChatBlock } from '../../../../shared/native-chat-types'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog'
import {
  getLocalImageCacheKey,
  useLocalImageSrc,
  releaseLocalImageSrc
} from '@/components/editor/useLocalImageSrc'
import { isNativeChatPastedImagePath } from './native-chat-image-paste'
import { useNativeChatImageActions } from './use-native-chat-image-actions'
import type { NativeChatImageRuntimeContext } from './native-chat-image-runtime-context'
import { resolveNativeChatImageDestination } from './native-chat-image-destination'
import { filesystemPathToFileUri } from '../../../../shared/file-uri-path'
import { isWindowsAbsolutePathLike } from '../../../../shared/cross-platform-path'

type VisibilityListener = (isVisible: boolean) => void

const visibilityListeners = new Map<Element, VisibilityListener>()
let visibilityObserver: IntersectionObserver | null = null

function observeTranscriptVisibility(element: Element, listener: VisibilityListener): () => void {
  if (typeof IntersectionObserver === 'undefined') {
    listener(true)
    return () => {}
  }

  visibilityObserver ??= new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        visibilityListeners.get(entry.target)?.(entry.isIntersecting)
      }
    },
    { rootMargin: '128px' }
  )
  visibilityListeners.set(element, listener)
  visibilityObserver.observe(element)

  return () => {
    visibilityListeners.delete(element)
    visibilityObserver?.unobserve(element)
    if (visibilityListeners.size === 0) {
      visibilityObserver?.disconnect()
      visibilityObserver = null
    }
  }
}

function renderableImageSource(source: string | undefined): boolean {
  return Boolean(source && /^(?:https?|data|blob):/i.test(source))
}

function transcriptImageFilePath(
  block: Extract<NativeChatBlock, { type: 'image-ref' }>,
  runtimeContext: NativeChatImageRuntimeContext | undefined
): string | null {
  let absolutePath: string | null
  if (block.url?.trim()) {
    absolutePath = resolveImageAbsolutePath(
      block.url.trim(),
      joinPath(runtimeContext?.worktreePath ?? '', 'image')
    )
  } else if (!block.path) {
    return null
  } else if (block.path.startsWith('/') || isWindowsAbsolutePathLike(block.path)) {
    absolutePath = block.path
  } else {
    absolutePath = runtimeContext?.worktreePath
      ? joinPath(runtimeContext.worktreePath, block.path)
      : null
  }
  return absolutePath && runtimeContext
    ? resolveNativeChatImageDestination(absolutePath, runtimeContext)
    : absolutePath
}

function transcriptImageIdentity(
  block: Extract<NativeChatBlock, { type: 'image-ref' }>,
  runtimeContext: NativeChatImageRuntimeContext | undefined
): string {
  const source = block.url?.trim() || block.path
  const filePath = transcriptImageFilePath(block, runtimeContext) ?? ''
  if (renderableImageSource(source)) {
    return `external\0${source ?? ''}`
  }
  return `${source ?? ''}\0${filePath}\0${
    runtimeContext === null
      ? 'unresolved'
      : runtimeContext === undefined
        ? 'pending'
        : getLocalImageCacheKey(filePath, runtimeContext.connectionId, runtimeContext)
  }`
}

function TranscriptImagePreview({
  block,
  runtimeContext,
  compact
}: {
  block: Extract<NativeChatBlock, { type: 'image-ref' }>
  runtimeContext: NativeChatImageRuntimeContext | undefined
  compact: boolean
}): React.JSX.Element {
  const [near, setNear] = useState(false)
  const [thumbnailErrorSrc, setThumbnailErrorSrc] = useState<string | null>(null)
  const [dialogErrorSrc, setDialogErrorSrc] = useState<string | null>(null)
  const ref = useRef<HTMLDivElement>(null)
  const source = block.url?.trim() || block.path
  const external = renderableImageSource(source)
  const filePath = external ? null : transcriptImageFilePath(block, runtimeContext)
  const fileUri = filePath ? filesystemPathToFileUri(filePath) : undefined
  const label =
    block.alt?.trim() ||
    (block.path && isNativeChatPastedImagePath(block.path)
      ? translate('components.native-chat.composer.pastedImageLabel', 'Pasted image')
      : block.path
        ? basename(block.path)
        : 'Image')
  const actions = useNativeChatImageActions({
    filePath,
    source,
    label,
    runtimeContext
  })
  const leaseActive = near || actions.previewOpen || actions.request !== null
  const localSrc = useLocalImageSrc(
    leaseActive && runtimeContext ? fileUri : undefined,
    filePath ?? '',
    runtimeContext?.connectionId,
    runtimeContext
  )
  const displaySrc = external && leaseActive ? source : localSrc
  const viewImageLabel = translate('components.native-chat.composer.viewAttachment', 'View image')
  const fallback = (
    <div
      className="flex max-w-full items-center gap-1.5 px-2 py-1 text-xs text-muted-foreground"
      title={label}
    >
      <ImageIcon className="size-3.5 shrink-0" />
      <span className="truncate">{label}</span>
    </div>
  )

  useEffect(() => {
    const element = ref.current
    if (!element) {
      return
    }
    return observeTranscriptVisibility(element, setNear)
  }, [])
  useEffect(() => {
    const context = runtimeContext
    if (!filePath || !fileUri || context === undefined || context === null) {
      return
    }
    if (!leaseActive) {
      releaseLocalImageSrc(fileUri, filePath, context.connectionId, context)
    }
    return () => releaseLocalImageSrc(fileUri, filePath, context.connectionId, context)
  }, [filePath, fileUri, leaseActive, runtimeContext])

  const showPreview =
    leaseActive &&
    Boolean(displaySrc) &&
    displaySrc !== thumbnailErrorSrc &&
    Boolean(source) &&
    (external || runtimeContext !== null)

  return (
    <div
      ref={ref}
      className={cn('relative max-w-full shrink-0', showPreview && (compact ? 'size-20' : 'w-80'))}
    >
      <button
        type="button"
        aria-label={`${viewImageLabel}: ${label}`}
        title={label}
        onClick={actions.onClick}
        disabled={!source || (!external && (!runtimeContext || !filePath))}
        className="flex size-full items-center justify-center overflow-hidden rounded-md border border-border bg-background transition-colors hover:border-ring focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-default disabled:hover:border-border"
      >
        {showPreview ? (
          <img
            src={displaySrc}
            alt={label}
            loading="lazy"
            onError={() => setThumbnailErrorSrc(displaySrc ?? null)}
            className={compact ? 'size-full object-cover' : 'max-h-64 max-w-full object-contain'}
          />
        ) : (
          fallback
        )}
      </button>
      {actions.request ? (
        <LinkActionPopover request={actions.request} onClose={actions.close} />
      ) : null}
      <Dialog open={actions.previewOpen} onOpenChange={actions.setPreviewOpen}>
        <DialogContent className="flex max-h-[90vh] max-w-[90vw] flex-col gap-3 border-border bg-background p-3 sm:max-w-4xl">
          <DialogTitle className="truncate text-sm">{label}</DialogTitle>
          <DialogDescription className="sr-only">
            {translate('components.native-chat.composer.imagePreview', 'Full-size image preview')}
          </DialogDescription>
          <div className="scrollbar-sleek flex min-h-0 items-center justify-center overflow-auto rounded-md bg-muted/20 p-2">
            {displaySrc && displaySrc !== dialogErrorSrc ? (
              <img
                src={displaySrc}
                alt={label}
                onError={() => setDialogErrorSrc(displaySrc)}
                className="max-h-[75vh] max-w-full object-contain"
              />
            ) : (
              <div className="flex items-center gap-2 py-12 text-sm text-muted-foreground">
                <ImageIcon className="size-4" />
                {translate(
                  'components.native-chat.composer.imagePreviewUnavailable',
                  'Preview unavailable'
                )}
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}

export function NativeChatImageAttachments({
  blocks,
  runtimeContext,
  compact = true,
  enablePreview = runtimeContext !== undefined
}: {
  blocks: NativeChatBlock[]
  runtimeContext?: NativeChatImageRuntimeContext
  compact?: boolean
  /** Keep legacy terminal chips unchanged until that lane opts into previews. */
  enablePreview?: boolean
}): React.JSX.Element | null {
  const images = blocks.filter((block) => block.type === 'image-ref')
  if (images.length === 0) {
    return null
  }
  const imageKeyCounts = new Map<string, number>()
  if (!enablePreview) {
    return (
      <div className="mb-2 flex flex-wrap gap-1.5">
        {images.map((image) => {
          const label = image.alt ?? image.path ?? image.url ?? 'Image'
          const imageKeyBase = `${label}-${image.url ?? ''}-${image.path ?? ''}`
          const occurrence = imageKeyCounts.get(imageKeyBase) ?? 0
          imageKeyCounts.set(imageKeyBase, occurrence + 1)
          const name =
            image.path && isNativeChatPastedImagePath(image.path)
              ? translate('components.native-chat.composer.pastedImageLabel', 'Pasted image')
              : image.path
                ? basename(image.path)
                : label
          return (
            <div
              key={`${imageKeyBase}-${occurrence}`}
              className="flex max-w-full items-center gap-1.5 rounded-md border border-border bg-background px-2 py-1 text-xs text-muted-foreground"
              title={label}
            >
              <ImageIcon className="size-3.5 shrink-0" />
              <span className="truncate">{name}</span>
            </div>
          )
        })}
      </div>
    )
  }
  return (
    <div className="mb-2 flex flex-wrap gap-1.5">
      {images.map((image) => {
        const label = image.alt ?? image.path ?? image.url ?? 'Image'
        const imageKeyBase = `${label}-${image.url ?? ''}-${image.path ?? ''}`
        const occurrence = imageKeyCounts.get(imageKeyBase) ?? 0
        imageKeyCounts.set(imageKeyBase, occurrence + 1)
        const identity = transcriptImageIdentity(image, runtimeContext)
        return (
          <TranscriptImagePreview
            key={`${imageKeyBase}-${identity}-${occurrence}`}
            block={image}
            runtimeContext={runtimeContext}
            compact={compact}
          />
        )
      })}
    </div>
  )
}
