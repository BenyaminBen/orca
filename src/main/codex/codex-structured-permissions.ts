import {
  CODEX_PERMISSION_MODES,
  classifyCodexPermissions,
  codexPermissionPolicy,
  decodeCodexPermissionPolicy,
  isCodexPermissionMode,
  readCodexPermissionPolicy,
  type CodexPermissionOptions,
  type CodexPermissionPolicy
} from '../../shared/codex-permissions'
import type { CodexSession } from './codex-structured-session-state'

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function selectedCodexPermissionPolicy(
  options: ReadonlyMap<string, string>
): CodexPermissionPolicy | undefined {
  const mode = options.get('permissions')
  return isCodexPermissionMode(mode)
    ? codexPermissionPolicy(mode)
    : decodeCodexPermissionPolicy(options.get('permissionState'))
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
  session.options.delete('permissions')
}

export async function readCodexPermissionOptions(
  session: CodexSession,
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
    }
  } catch {
    unavailable = 'Could not verify the permission modes allowed by this host.'
  }
  const policy = session.reportedOptions.permissions
  const pending = session.options.get('permissions')
  const choices = CODEX_PERMISSION_MODES.map(({ value }) => {
    const preset = codexPermissionPolicy(value)
    const sandbox = value === 'full-access' ? 'danger-full-access' : 'workspace-write'
    const approvals = requirements?.allowedApprovalPolicies
    const sandboxes = requirements?.allowedSandboxModes
    const profile = value === 'full-access' ? ':danger-full-access' : ':workspace'
    const profiles = requirements?.allowedPermissionProfiles
    let disabledReason = unavailable
    if (
      (Array.isArray(approvals) && !approvals.includes(preset.approvalPolicy)) ||
      (Array.isArray(sandboxes) && !sandboxes.includes(sandbox)) ||
      (record(profiles) && profiles[profile] !== true)
    ) {
      disabledReason = 'This mode is restricted by the host policy.'
    }
    if (value === 'approve-for-me' && !policy?.approvalsReviewer) {
      disabledReason = 'This version does not report support for automatic approval review.'
    }
    if (value !== 'approve-for-me' && record(requirements?.autoReview)) {
      const requiredModels = requirements.autoReview.requiredOnModels
      const model = session.options.get('model') ?? session.reportedOptions.model
      if (Array.isArray(requiredModels) && requiredModels.includes(model)) {
        disabledReason = 'The host requires automatic approval review for this model.'
      }
    }
    return { value, ...(disabledReason ? { disabledReason } : {}) }
  })
  return {
    ...(policy ? { current: classifyCodexPermissions(policy), policy } : {}),
    ...(isCodexPermissionMode(pending) ? { pending } : {}),
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
  if (session.dispatchPending || session.activeTurnIds?.size || session.prompts.sizes.prompts) {
    throw new Error('Wait for the current turn and its approvals before changing permissions.')
  }
  const choices = await readCodexPermissionOptions(session, timeoutMs)
  const choice = choices.choices.find((entry) => entry.value === value)
  if (!choice || choice.disabledReason) {
    throw new Error(choice?.disabledReason ?? 'This permission mode is unavailable.')
  }
  if (session.dispatchPending || session.activeTurnIds?.size || session.prompts.sizes.prompts) {
    throw new Error('Wait for the current turn and its approvals before changing permissions.')
  }
  session.options.delete('approvalPolicy')
  session.options.delete('approvalsReviewer')
  session.options.set('permissions', value)
  return Object.fromEntries(session.options)
}
