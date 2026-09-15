import type { StructuredAgentSessionAdapter } from './structured-agent-session-adapter'
import { encodeStructuredAgentSessionOptionValue } from '../../../shared/structured-agent-session-option-codec'

export async function readNativeSessionOptions(input: {
  adapter: Pick<StructuredAgentSessionAdapter, 'readOptions' | 'readOptionRestoreFailures'>
  sessionId: string
  fence: number
  priorOptions?: Readonly<Record<string, string>>
}): Promise<Readonly<Record<string, string>> | undefined> {
  const { adapter, sessionId, fence, priorOptions } = input
  const reported = await adapter.readOptions?.({ sessionId, fence })
  if (!reported) {
    return undefined
  }
  const skipped = new Set(input.adapter.readOptionRestoreFailures?.(sessionId) ?? [])
  const restored = priorOptions ? { ...priorOptions } : {}
  delete restored.model
  delete restored.effort
  delete restored.fastMode
  if (
    reported.permissions?.policy ||
    reported.permissions?.desired ||
    reported.permissions?.pending
  ) {
    delete restored.permissionState
    delete restored.approvalPolicy
    delete restored.approvalsReviewer
    if (reported.permissions.desired || reported.permissions.pending) {
      restored.permissions = reported.permissions.desired ?? reported.permissions.pending!
    }
    if (reported.permissions.policy) {
      restored.permissionState = JSON.stringify(reported.permissions.policy)
    }
    if (reported.permissions.recovery) {
      restored.permissionRecovery = JSON.stringify(reported.permissions.recovery)
    } else {
      delete restored.permissionRecovery
    }
  }
  for (const key of skipped) {
    delete restored[key]
  }
  const fastMode =
    reported.current.fastMode === undefined
      ? undefined
      : encodeStructuredAgentSessionOptionValue('fastMode', reported.current.fastMode)
  return {
    ...restored,
    model: reported.current.model,
    ...(reported.current.effort ? { effort: reported.current.effort } : {}),
    ...(fastMode !== undefined && fastMode !== null ? { fastMode } : {})
  }
}
