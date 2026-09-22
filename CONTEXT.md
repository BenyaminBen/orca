# Orca

Domain language for conversation permissions in Orca.

## Language

**Conversation**:
An ongoing exchange with its own history and permissions. Its presentation depends on the conversation mode.
_Avoid_: View, terminal process

**Structured native chat**:
A local conversation presented through messages and structured provider events. It has no underlying interactive terminal or terminal-view switch.
_Avoid_: Terminal-backed chat

**Bridge chat**:
A message-based presentation backed by an interactive terminal. Remote execution uses this mode or the terminal view when structured native chat is unavailable.
_Avoid_: Structured native chat

**Terminal view**:
The interactive command-line presentation available for terminal-backed conversations.
_Avoid_: Separate conversation

**Session handoff**:
A transfer of conversation ownership between native and terminal runtimes. Host support for a transfer does not mean a structured chat offers a terminal switch.
_Avoid_: Native chat view toggle

**Global permission defaults**:
The Orca settings from which each new native chat receives its initial permissions.
_Avoid_: Last selected chat mode

**Conversation permission choice**:
The permission setting owned by one conversation, initially inherited from the global defaults and subsequently selected for that conversation.
_Avoid_: Global permission defaults

**Effective conversation permissions**:
The permissions actually governing work in a conversation, as confirmed by its owning provider runtime.
_Avoid_: Requested permissions, selected label

**Permission preset**:
One of the three official permission choices offered by the selector. An existing conversation's permissions can differ from all three presets without adding another selectable choice.
_Avoid_: Every possible permission configuration

**Permission selector**:
The native chat control for selecting approval and sandbox settings.
_Avoid_: Reasoning effort selector

**Permission restoration failure**:
A retained conversation choice that could not be applied while a permitted effective mode remains available. Messages can continue under that effective mode; retrying checks whether the selected mode can be applied to a subsequent message.
_Avoid_: Pending selection, send blocker
