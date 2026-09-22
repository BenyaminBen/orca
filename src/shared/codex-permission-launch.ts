import {
  codexPermissionPolicy,
  decodeCodexPermissionPolicy,
  decodeCodexPermissionRecovery,
  isCodexPermissionMode,
  type CodexPermissionPolicy
} from './codex-permissions'
import type { SessionOptionValue } from './native-chat-session-options'

export function permissionPolicyFromOptions(
  values: Readonly<Record<string, SessionOptionValue>> | null | undefined
): CodexPermissionPolicy | undefined {
  const recovery = decodeCodexPermissionRecovery(
    typeof values?.permissionRecovery === 'string' ? values.permissionRecovery : undefined,
    typeof values?.permissions === 'string' ? values.permissions : undefined
  )
  if (recovery) {
    return recovery.effective
  }
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
