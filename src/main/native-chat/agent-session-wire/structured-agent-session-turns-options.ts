import type { AgentSessionOptionResult } from '../../../shared/agent-session-wire'
import { isAgentSessionOptionRejectedError } from './structured-agent-session-option-error'
import type { AgentSessionTurnContext, TurnOutcome } from './structured-agent-session-turns'
import { conversationActivityBlocked } from './structured-conversation-command-admission'

export async function performSetOption(
  ctx: AgentSessionTurnContext,
  input: { key: string; value: string }
): Promise<TurnOutcome<AgentSessionOptionResult>> {
  const blocked = input.key === 'permissions' ? conversationActivityBlocked(ctx) : null
  if (blocked) {
    return { ok: false, refusal: { code: 'agent_session_operation_invalid', message: blocked } }
  }
  let applied: void | Readonly<Record<string, string>>
  try {
    applied = await ctx.adapter.setOption({
      sessionId: ctx.sessionId,
      ...input,
      fence: ctx.fence
    })
  } catch (error) {
    if (isAgentSessionOptionRejectedError(error)) {
      return {
        ok: false,
        refusal: { code: 'agent_session_operation_invalid', message: error.message }
      }
    }
    throw error
  }
  await ctx.persistOptions(applied ?? { [input.key]: input.value })
  ctx.publish()
  return { ok: true, value: { ...input, ...(applied ? { options: { ...applied } } : {}) } }
}
