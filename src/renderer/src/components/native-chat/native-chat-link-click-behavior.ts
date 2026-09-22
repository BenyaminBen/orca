import {
  terminalLinkClickBehaviorFor,
  type TerminalLinkClickBehavior
} from '@/components/terminal-pane/terminal-link-click-behavior'

export function nativeChatLinkClickBehaviorFor(
  settings: Parameters<typeof terminalLinkClickBehaviorFor>[0]
): TerminalLinkClickBehavior {
  // Older chat profiles opened links directly when destination menus were disabled.
  if (settings?.terminalLinkClickBehavior === undefined) {
    return settings?.terminalLinkActionPopoverEnabled === false ? 'open' : 'actions'
  }
  return terminalLinkClickBehaviorFor(settings)
}
