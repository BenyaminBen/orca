export const CODEX_PERMISSION_MODES = [
  {
    value: 'ask-for-approval',
    label: 'Ask for approval',
    description: 'Ask before running commands outside the sandbox.'
  },
  {
    value: 'approve-for-me',
    label: 'Approve for me',
    description: 'Only ask for actions detected as potentially unsafe.'
  },
  {
    value: 'full-access',
    label: 'Full Access',
    description: 'Allow unrestricted commands and network access without approval.'
  }
] as const

export type CodexPermissionMode = (typeof CODEX_PERMISSION_MODES)[number]['value']
export type CodexPermissionLabel = CodexPermissionMode | 'read-only' | 'custom'

export type CodexPermissionPolicy = {
  approvalPolicy: string | Record<string, unknown>
  approvalsReviewer?: string
  sandboxPolicy: Record<string, unknown> & { type: string }
}

export type CodexPermissionOptions = {
  /** Absent is unknown; a pending selection is never evidence of effective state. */
  current?: CodexPermissionLabel
  pending?: CodexPermissionMode
  policy?: CodexPermissionPolicy
  choices: { value: CodexPermissionMode; disabledReason?: string }[]
}

export function unavailableCodexPermissionOptions(reason: string): CodexPermissionOptions {
  return { choices: CODEX_PERMISSION_MODES.map(({ value }) => ({ value, disabledReason: reason })) }
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function isCodexPermissionMode(value: unknown): value is CodexPermissionMode {
  return CODEX_PERMISSION_MODES.some((mode) => mode.value === value)
}

export function readCodexPermissionPolicy(value: unknown): CodexPermissionPolicy | undefined {
  if (!record(value)) {
    return undefined
  }
  const sandbox = value.sandboxPolicy ?? value.sandbox
  const approval = value.approvalPolicy
  if (
    !record(sandbox) ||
    typeof sandbox.type !== 'string' ||
    (typeof approval !== 'string' && !record(approval))
  ) {
    return undefined
  }
  return {
    approvalPolicy: approval,
    ...(typeof value.approvalsReviewer === 'string'
      ? { approvalsReviewer: value.approvalsReviewer }
      : {}),
    sandboxPolicy: { ...sandbox, type: sandbox.type }
  }
}

export function decodeCodexPermissionPolicy(
  value: string | undefined
): CodexPermissionPolicy | undefined {
  try {
    return value ? readCodexPermissionPolicy(JSON.parse(value)) : undefined
  } catch {
    return undefined
  }
}

export function codexPermissionPolicy(mode: CodexPermissionMode): CodexPermissionPolicy {
  return mode === 'full-access'
    ? {
        approvalPolicy: 'never',
        approvalsReviewer: 'user',
        sandboxPolicy: { type: 'dangerFullAccess' }
      }
    : {
        approvalPolicy: 'on-request',
        approvalsReviewer: mode === 'approve-for-me' ? 'auto_review' : 'user',
        sandboxPolicy: {
          type: 'workspaceWrite',
          writableRoots: [],
          networkAccess: false,
          excludeTmpdirEnvVar: false,
          excludeSlashTmp: false
        }
      }
}

export function classifyCodexPermissions(policy: CodexPermissionPolicy): CodexPermissionLabel {
  const { approvalPolicy, approvalsReviewer, sandboxPolicy } = policy
  if (sandboxPolicy.type === 'readOnly') {
    return 'read-only'
  }
  if (sandboxPolicy.type === 'dangerFullAccess' && approvalPolicy === 'never') {
    return 'full-access'
  }
  if (
    sandboxPolicy.type === 'workspaceWrite' &&
    sandboxPolicy.networkAccess === false &&
    Array.isArray(sandboxPolicy.writableRoots) &&
    sandboxPolicy.writableRoots.length === 0 &&
    sandboxPolicy.excludeTmpdirEnvVar !== true &&
    sandboxPolicy.excludeSlashTmp !== true &&
    approvalPolicy === 'on-request'
  ) {
    if (approvalsReviewer === 'auto_review') {
      return 'approve-for-me'
    }
    if (approvalsReviewer === 'user') {
      return 'ask-for-approval'
    }
  }
  return 'custom'
}

export function codexPermissionLabel(value: CodexPermissionLabel | undefined): string {
  return (
    CODEX_PERMISSION_MODES.find((mode) => mode.value === value)?.label ??
    (value === 'read-only' ? 'Read-only' : value === 'custom' ? 'Custom' : 'Permissions')
  )
}
