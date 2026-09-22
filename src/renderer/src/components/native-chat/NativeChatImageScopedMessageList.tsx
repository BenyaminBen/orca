import type { ComponentProps } from 'react'
import { NativeChatMessageList } from './NativeChatMessageList'
import { NativeChatImageScopeContext } from './native-chat-image-scope'

export function NativeChatImageScopedMessageList(
  props: ComponentProps<typeof NativeChatMessageList>
): React.JSX.Element {
  return (
    <NativeChatImageScopeContext.Provider
      value={props.isVisible === false ? null : props.session.sessionId}
    >
      <NativeChatMessageList {...props} />
    </NativeChatImageScopeContext.Provider>
  )
}
