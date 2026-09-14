import { createContext } from 'react'

/** Null suspends image overlays while the owning chat is hidden. */
export const NativeChatImageScopeContext = createContext<string | null>('')
