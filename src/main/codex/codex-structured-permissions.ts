import {
  CODEX_PERMISSION_MODES,
  classifyCodexPermissions,
  codexPermissionPolicy,
  decodeCodexPermissionRecovery,
  isCodexPermissionMode,
  readCodexPermissionPolicy,
  type CodexPermissionOptions,
  type CodexPermissionPolicy
} from '../../shared/codex-permissions'
import { permissionPolicyFromOptions } from '../../shared/codex-permission-launch'
import type { CodexSession } from './codex-structured-session-state'

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function selectedCodexPermissionPolicy(
  options: ReadonlyMap<string, string>
): CodexPermissionPolicy | undefined {
  return permissionPolicyFromOptions(Object.fromEntries(options))
}

export function observeCodexPermissions(session: CodexSession, params: unknown): void {
  if (!record(params) || params.threadId !== session.threadId) {
    return
  }
  const policy = readCodexPermissionPolicy(params.threadSettings)
  if (!policy) {
    return
  }
  session.reportedOptions.permissions = policy
  session.options.set('permissionState', JSON.stringify(policy))
}

export async function readCodexPermissionOptions(
  session: Pick<CodexSession, 'connection' | 'reportedOptions' | 'options'>,
  timeoutMs?: number
): Promise<CodexPermissionOptions> {
  let requirements: Record<string, unknown> | null = null
  let unavailable: string | undefined
  try {
    const response = await session.connection.request('configRequirements/read', {}, { timeoutMs })
    if (!record(response) || !('requirements' in response)) {
      unavailable = 'Permission requirements have not been reported by this version.'
    } else if (record(response.requirements)) {
      requirements = response.requirements
    } else if (response.requirements !== null) {
      unavailable = 'Permission requirements have not been reported by this version.'
    }
  } catch {
    unavailable = 'Could not verify the permission modes allowed by this host.'
  }
  const pending = session.options.get('permissions')
  const recovery = decodeCodexPermissionRecovery(session.options.get('permissionRecovery'), pending)
  const policy = recovery?.effective ?? session.reportedOptions.permissions
  const choices = CODEX_PERMISSION_MODES.map(({ value }) => {
    const preset = codexPermissionPolicy(value)
    const sandbox = value === 'full-access' ? 'danger-full-access' : 'workspace-write'
    const approvals = requirements?.allowedApprovalPolicies
    const sandboxes = requirements?.allowedSandboxModes
    const profile = value === 'full-access' ? ':danger-full-access' : ':workspace'
    const profiles = requirements?.allowedPermissionProfiles
    let disabledReason = unavailable
    let restrictedByHost = false
    if (
      (Array.isArray(approvals) && !approvals.includes(preset.approvalPolicy)) ||
      (Array.isArray(sandboxes) && !sandboxes.includes(sandbox)) ||
      (record(profiles) && profiles[profile] !== true)
    ) {
      disabledReason = 'This mode is restricted by the host policy.'
      restrictedByHost = true
    }
    if (
      value === 'approve-for-me' &&
      !policy?.approvalsReviewer &&
      !record(requirements?.autoReview)
    ) {
      disabledReason = 'This version does not report support for automatic approval review.'
    }
    if (value !== 'approve-for-me' && record(requirements?.autoReview)) {
      const requiredModels = requirements.autoReview.requiredOnModels
      const model = session.options.get('model') ?? session.reportedOptions.model
      if (Array.isArray(requiredModels) && requiredModels.includes(model)) {
        disabledReason = 'The host requires automatic approval review for this model.'
        restrictedByHost = true
      }
    }
    return {
      value,
      ...(disabledReason ? { disabledReason } : {}),
      ...(restrictedByHost ? { restrictedByHost: true as const } : {})
    }
  })
  return {
    ...(policy ? { current: classifyCodexPermissions(policy), policy } : {}),
    ...(isCodexPermissionMode(pending) ? { desired: pending } : {}),
    ...(recovery ? { restoration: 'failed' as const, recovery } : {}),
    ...(!recovery &&
    isCodexPermissionMode(pending) &&
    (!policy || classifyCodexPermissions(policy) !== pending)
      ? { pending }
      : {}),
    choices
  }
}

export async function selectCodexPermissions(
  session: CodexSession,
  value: string,
  timeoutMs?: number
): Promise<Readonly<Record<string, string>>> {
  if (!isCodexPermissionMode(value)) {
    throw new Error('Unknown permission mode.')
  }
  if (session.ended || session.requestedClose) {
    throw new Error('The conversation has closed.')
  }
  if (session.dispatchPending || session.activeTurnIds?.size || session.prompts.sizes.prompts) {
    throw new Error('Wait for the current turn and its approvals before changing permissions.')
  }
  const choices = await readCodexPermissionOptions(session, timeoutMs)
  if (session.ended || session.requestedClose) {
    throw new Error('The conversation has closed.')
  }
  const choice = choices.choices.find((entry) => entry.value === value)
  if (!choice || choice.disabledReason) {
    throw new Error(choice?.disabledReason ?? 'This permission mode is unavailable.')
  }
  if (session.dispatchPending || session.activeTurnIds?.size || session.prompts.sizes.prompts) {
    throw new Error('Wait for the current turn and its approvals before changing permissions.')
  }
  session.options.delete('approvalPolicy')
  session.options.delete('approvalsReviewer')
  session.options.delete('permissionRecovery')
  session.options.set('permissions', value)
  return Object.fromEntries(session.options)
}
