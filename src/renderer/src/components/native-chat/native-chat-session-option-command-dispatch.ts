import type {
  CatalogAgentInteractionDetection,
  CatalogCommandDelivery
} from '../../../../shared/agent-session-option-catalog'
import type { ClaudeModelSwitchOutcome } from './claude-model-switch-confirmation'
import type {
  CodexPermissionMode,
  CodexPermissionOptions
} from '../../../../shared/codex-permissions'

export type NativeChatSessionOptionDispatchResult = {
  permissions?: CodexPermissionOptions
  outcome?: ClaudeModelSwitchOutcome
}

export type NativeChatSessionOptionDispatchCommand = (
  command: string,
  options?: {
    permissions?: CodexPermissionMode | 'read' | 'preserve-on-clear'
    detectAgentInteraction?: CatalogAgentInteractionDetection
    expectedChoiceLabel?: string
    delivery?: CatalogCommandDelivery
  }
) =>
  | Promise<NativeChatSessionOptionDispatchResult | void>
  | NativeChatSessionOptionDispatchResult
  | void
