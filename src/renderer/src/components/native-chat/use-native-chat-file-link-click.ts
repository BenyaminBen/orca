import { useCallback } from 'react'
import type { CommentMarkdownLinkClickHandler } from '@/components/sidebar/CommentMarkdown'
import { resolveNativeChatFileLink, type NativeChatFileLinkContext } from './native-chat-file-link'
import {
  handleNativeChatFileLink,
  type NativeChatFileLinkActions
} from './native-chat-file-link-actions'

export function useNativeChatFileLinkClick(
  context: NativeChatFileLinkContext | null,
  getActions?: (event: Parameters<CommentMarkdownLinkClickHandler>[0]) => NativeChatFileLinkActions
): CommentMarkdownLinkClickHandler | undefined {
  const openFileLink = useCallback<CommentMarkdownLinkClickHandler>(
    (event, href) => {
      const target = resolveNativeChatFileLink(href, context)
      if (!target || !context) {
        return
      }
      handleNativeChatFileLink(event, target, context, getActions?.(event))
    },
    [context, getActions]
  )
  return context ? openFileLink : undefined
}
