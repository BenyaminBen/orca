import {
  classifyCodexPermissions,
  codexPermissionPolicy,
  decodeCodexPermissionRecovery,
  isCodexPermissionMode
} from '../../shared/codex-permissions'
import { permissionPolicyFromOptions } from '../../shared/codex-permission-launch'
import type { CodexAppServerConnection } from './codex-app-server-connection'
import { readCodexPermissionOptions } from './codex-structured-permissions'
import { openCodexThread, type CodexOpenedThread } from './codex-structured-thread-open'
import type { CodexStructuredLaunch } from './codex-structured-session-state'

export async function openCodexThreadRestoringPermissions(input: {
  connection: CodexAppServerConnection
  launch: Parameters<typeof openCodexThread>[1] & Pick<CodexStructuredLaunch, 'initialPermissions'>
  options: Map<string, string>
  timeoutMs?: number
  assertCurrent: () => void
}): Promise<CodexOpenedThread> {
  const { connection, launch, options, timeoutMs, assertCurrent } = input
  const savedPolicy = permissionPolicyFromOptions(Object.fromEntries(options))
  let initialPolicy = !launch.resumeThreadId && !savedPolicy ? launch.initialPermissions : undefined
  const requestedPolicy = savedPolicy ?? initialPolicy
  const desired =
    options.get('permissions') ??
    (requestedPolicy ? classifyCodexPermissions(requestedPolicy) : undefined)
  let recovery = decodeCodexPermissionRecovery(options.get('permissionRecovery'), desired)
  let requiredFallback = recovery?.effective
  if (isCodexPermissionMode(desired) && (recovery || desired !== 'ask-for-approval')) {
    const permissions = await readCodexPermissionOptions(
      { connection, options, reportedOptions: {} },
      timeoutMs
    )
    assertCurrent()
    const requestedMode = recovery ? classifyCodexPermissions(recovery.effective) : desired
    const requested = permissions.choices.find(({ value }) => value === requestedMode)
    const fallback = permissions.choices.find(
      ({ value, disabledReason }) =>
        !disabledReason &&
        (value === 'ask-for-approval' || (desired === 'full-access' && value === 'approve-for-me'))
    )
    if (requested?.restrictedByHost) {
      if (!fallback) {
        throw new Error('No permitted permission preset is available on this host.')
      }
      requiredFallback = codexPermissionPolicy(fallback.value)
      if (initialPolicy) {
        initialPolicy = requiredFallback
      } else {
        recovery = { desired, effective: requiredFallback }
        options.set('permissions', desired)
      }
    }
  }
  assertCurrent()
  const opened = await openCodexThread(
    connection,
    {
      ...launch,
      permissions: recovery?.effective ?? savedPolicy ?? initialPolicy
    },
    timeoutMs
  )
  assertCurrent()
  if (requiredFallback) {
    // A fallback is usable only when this acquisition confirms its effective policy.
    if (
      !opened.permissions ||
      classifyCodexPermissions(opened.permissions) !== classifyCodexPermissions(requiredFallback)
    ) {
      throw new Error('The provider did not confirm the permitted recovery policy.')
    }
  }
  if (recovery) {
    options.set(
      'permissionRecovery',
      JSON.stringify({ ...recovery, effective: opened.permissions })
    )
  }
  return opened
}
