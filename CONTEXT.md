# Orca

Domain language for conversation permissions in Orca.

## Language

**Conversation**:
An ongoing exchange with its own history and permissions, which can be presented in chat or terminal views.
_Avoid_: View, terminal process

**Chat view**:
Orca's message-based presentation of a conversation.
_Avoid_: Conversation identity

**Terminal view**:
The interactive command-line presentation of a conversation.
_Avoid_: Separate conversation

**Global permission defaults**:
The Orca settings from which each new native chat receives its initial permissions.
_Avoid_: Last selected chat mode

**Conversation permission choice**:
The permission setting owned by one conversation, initially inherited from the global defaults and subsequently selected for that conversation.
_Avoid_: Global permission defaults

**Effective conversation permissions**:
The permissions actually governing work in a conversation, as confirmed by its command-line runtime.
_Avoid_: Requested permissions, selected label

**Permission preset**:
One of the three official permission choices offered by the selector. An existing conversation's permissions can differ from all three presets without adding another selectable choice.
_Avoid_: Every possible permission configuration

**Permission selector**:
The native chat control for selecting approval and sandbox settings.
_Avoid_: Reasoning effort selector
