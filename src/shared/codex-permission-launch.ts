import {
  codexPermissionPolicy,
  decodeCodexPermissionPolicy,
  isCodexPermissionMode,
  type CodexPermissionPolicy
} from './codex-permissions'
import type { SessionOptionValue } from './native-chat-session-options'

export function permissionPolicyFromOptions(
  values: Readonly<Record<string, SessionOptionValue>> | null | undefined
): CodexPermissionPolicy | undefined {
  return isCodexPermissionMode(values?.permissions)
    ? codexPermissionPolicy(values.permissions)
    : decodeCodexPermissionPolicy(
        typeof values?.permissionState === 'string' ? values.permissionState : undefined
      )
}

export function codexPermissionThreadOverrides(
  policy: CodexPermissionPolicy | undefined
): Record<string, unknown> {
  if (!policy) {
    return {}
  }
  const { sandboxPolicy, ...approval } = policy
  const sandbox =
    sandboxPolicy.type === 'dangerFullAccess'
      ? 'danger-full-access'
      : sandboxPolicy.type === 'workspaceWrite'
        ? 'workspace-write'
        : sandboxPolicy.type === 'readOnly'
          ? 'read-only'
          : undefined
  if (!sandbox) {
    throw new Error('This sandbox configuration cannot be transferred to a new session.')
  }
  if (sandboxPolicy.type === 'readOnly' && sandboxPolicy.networkAccess !== false) {
    throw new Error('This read-only network configuration cannot be transferred to a new session.')
  }
  return {
    ...approval,
    sandbox,
    ...(sandboxPolicy.type === 'workspaceWrite'
      ? {
          config: {
            'sandbox_workspace_write.writable_roots': sandboxPolicy.writableRoots,
            'sandbox_workspace_write.network_access': sandboxPolicy.networkAccess,
            'sandbox_workspace_write.exclude_tmpdir_env_var': sandboxPolicy.excludeTmpdirEnvVar,
            'sandbox_workspace_write.exclude_slash_tmp': sandboxPolicy.excludeSlashTmp
          }
        }
      : {})
  }
}

export function codexPermissionLaunchArgs(policy: CodexPermissionPolicy): string[] {
  const overrides = codexPermissionThreadOverrides(policy)
  if (typeof policy.approvalPolicy !== 'string') {
    throw new Error('This approval configuration cannot be transferred to terminal view.')
  }
  const args = [
    '-c',
    `approval_policy=${JSON.stringify(policy.approvalPolicy)}`,
    '-c',
    `sandbox_mode=${JSON.stringify(overrides.sandbox)}`
  ]
  if (policy.approvalsReviewer) {
    args.push('-c', `approvals_reviewer=${JSON.stringify(policy.approvalsReviewer)}`)
  }
  if (policy.sandboxPolicy.type === 'workspaceWrite') {
    for (const [key, value] of Object.entries({
      writable_roots: policy.sandboxPolicy.writableRoots,
      network_access: policy.sandboxPolicy.networkAccess,
      exclude_tmpdir_env_var: policy.sandboxPolicy.excludeTmpdirEnvVar,
      exclude_slash_tmp: policy.sandboxPolicy.excludeSlashTmp
    })) {
      if (value !== undefined) {
        args.push('-c', `sandbox_workspace_write.${key}=${JSON.stringify(value)}`)
      }
    }
  }
  return args
}

export function removeCodexPermissionArgs(tokens: readonly string[]): string[] {
  const kept: string[] = []
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i]!
    if (token === '--') {
      kept.push(...tokens.slice(i))
      break
    }
    const flag = token.split('=')[0]
    if (
      [
        '--yolo',
        '--dangerously-bypass-approvals-and-sandbox',
        '--full-auto',
        '--approve-for-me'
      ].includes(flag!)
    ) {
      continue
    }
    if (['-a', '--ask-for-approval', '-s', '--sandbox'].includes(flag!)) {
      if (!token.includes('=')) {
        i++
      }
      continue
    }
    if (flag === '-c' || flag === '--config') {
      const inline = token.includes('=')
      const value = inline ? token.slice(token.indexOf('=') + 1) : tokens[i + 1]
      if (
        /^(approval_policy|approvals_reviewer|sandbox_mode|sandbox_workspace_write(?:\.[\w]+)?|default_permissions)\s*=/.test(
          value ?? ''
        )
      ) {
        if (!inline) {
          i++
        }
        continue
      }
    }
    kept.push(token)
  }
  return kept
}
