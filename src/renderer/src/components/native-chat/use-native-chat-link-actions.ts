import { useCallback, useEffect, useRef, useState, type RefObject } from 'react'
import {
  closeLinkActionRequest,
  type LinkActionRequest
} from '@/components/link-actions/link-action-request'
import { httpLinkActionDestinationsFor } from '@/lib/http-link-destinations'
import type { CommentMarkdownLinkClickHandler } from '@/components/sidebar/CommentMarkdown'
import { routeNativeChatHref } from '../../../../shared/native-chat-href-routing'
import { useAppStore } from '../../store'
import type { NativeChatFileLinkContext } from './native-chat-file-link'
import {
  canNativeChatOpenOwnedBrowser,
  resolveNativeChatHttpLinkSourceOwner
} from './native-chat-http-link-source-owner'
import { handleNativeChatWebLink } from './native-chat-web-link-actions'
import { nativeChatLinkClickBehaviorFor } from './native-chat-link-click-behavior'
import { useNativeChatFileLinkClick } from './use-native-chat-file-link-click'

export type NativeChatLinkActions = {
  onLinkClick: CommentMarkdownLinkClickHandler | undefined
  linkActionRequest: LinkActionRequest | null
  closeLinkActions: (dismissed?: LinkActionRequest) => void
}

/** Transcript files and web links share the terminal's destination popover. */
export function useNativeChatLinkActions(
  context: NativeChatFileLinkContext | null,
  rootRef: RefObject<HTMLElement | null>,
  scope: { sessionId: string | null; isVisible: boolean }
): NativeChatLinkActions {
  const [linkActionRequest, setLinkActionRequest] = useState<LinkActionRequest | null>(null)
  const activeRequestRef = useRef<LinkActionRequest | null>(null)
  const requestGenerationRef = useRef(0)
  const mountedRef = useRef(true)
  const scopeKey = JSON.stringify([
    context?.worktreeId,
    context?.worktreePath,
    context?.runtimeEnvironmentId,
    scope.sessionId
  ])
  const scopeIdentity = `${scopeKey}:${scope.isVisible ? 'visible' : 'hidden'}`
  const scopeIdentityRef = useRef(scopeIdentity)
  const [previousScopeIdentity, setPreviousScopeIdentity] = useState(scopeIdentity)
  if (previousScopeIdentity !== scopeIdentity) {
    requestGenerationRef.current += 1
    scopeIdentityRef.current = scopeIdentity
    activeRequestRef.current = null
    setPreviousScopeIdentity(scopeIdentity)
    setLinkActionRequest(null)
  }
  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      requestGenerationRef.current += 1
    }
  }, [])
  const getFileActions = useCallback(
    (event: Parameters<CommentMarkdownLinkClickHandler>[0]) => {
      const anchor = event.currentTarget
      const requestGeneration = requestGenerationRef.current
      const requestScopeIdentity = scopeIdentityRef.current
      const isCurrentScope = (): boolean =>
        mountedRef.current && scopeIdentityRef.current === requestScopeIdentity && scope.isVisible
      const isCurrentRequest = (): boolean =>
        isCurrentScope() && requestGenerationRef.current === requestGeneration
      return {
        plainClickBehavior: nativeChatLinkClickBehaviorFor(useAppStore.getState().settings),
        request: (request: LinkActionRequest) => {
          if (isCurrentRequest()) {
            activeRequestRef.current = request
            setLinkActionRequest(request)
          }
        },
        replaceRequest: (current: LinkActionRequest, replacement: LinkActionRequest) => {
          if (!isCurrentRequest()) {
            return
          }
          if (activeRequestRef.current !== current) {
            return
          }
          activeRequestRef.current = replacement
          setLinkActionRequest((active) => (active === current ? replacement : active))
        },
        isCurrentRequest,
        isCurrentScope,
        restoreFocus: () =>
          (anchor.isConnected ? anchor : rootRef.current)?.focus({ preventScroll: true })
      }
    },
    [rootRef, scope.isVisible]
  )
  const openFileLink = useNativeChatFileLinkClick(context, getFileActions)
  const closeLinkActions = useCallback((dismissed?: LinkActionRequest) => {
    const current = activeRequestRef.current
    const next = closeLinkActionRequest(current, dismissed)
    if (next === current) {
      return
    }
    requestGenerationRef.current += 1
    activeRequestRef.current = next
    setLinkActionRequest(next)
  }, [])

  const onLinkClick = useCallback<CommentMarkdownLinkClickHandler>(
    (event, href) => {
      if (!context) {
        return
      }
      requestGenerationRef.current += 1
      activeRequestRef.current = null
      setLinkActionRequest(null)
      const route = routeNativeChatHref(href)
      if (route.kind === 'file') {
        openFileLink?.(event, href)
        return
      }
      // mailto: and other schemes keep the anchor's default handling.
      if (route.kind !== 'web' || !/^https?:/i.test(route.url)) {
        return
      }
      // Read at click time: settings and workspace ownership must not re-render the transcript.
      const state = useAppStore.getState()
      const sourceOwner = resolveNativeChatHttpLinkSourceOwner(state, context.worktreeId)
      const plainClickBehavior = nativeChatLinkClickBehaviorFor(state.settings)
      const anchor = event.currentTarget
      handleNativeChatWebLink(event, route.url, {
        worktreeId: context.worktreeId,
        sourceOwner,
        destinations: httpLinkActionDestinationsFor(
          state.settings,
          sourceOwner,
          canNativeChatOpenOwnedBrowser(state, context.worktreeId, sourceOwner)
        ),
        actionsEnabled: plainClickBehavior === 'actions',
        plainClickBehavior,
        restoreFocus: () =>
          (anchor.isConnected ? anchor : rootRef.current)?.focus({ preventScroll: true }),
        request: (request) => {
          activeRequestRef.current = request
          setLinkActionRequest(request)
        }
      })
    },
    [context, openFileLink, rootRef]
  )

  return {
    onLinkClick: context ? onLinkClick : undefined,
    linkActionRequest,
    closeLinkActions
  }
}
