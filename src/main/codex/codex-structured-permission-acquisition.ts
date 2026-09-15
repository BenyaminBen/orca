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

export async function openCodexThreadRestoringPermissions(input: {
  connection: CodexAppServerConnection
  launch: Parameters<typeof openCodexThread>[1]
  options: Map<string, string>
  timeoutMs?: number
  assertCurrent: () => void
}): Promise<CodexOpenedThread> {
  const { connection, launch, options, timeoutMs, assertCurrent } = input
  const desired = options.get('permissions')
  let recovery = decodeCodexPermissionRecovery(options.get('permissionRecovery'), desired)
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
    if (requested?.restrictedByHost && fallback) {
      recovery = { desired, effective: codexPermissionPolicy(fallback.value) }
    }
  }
  assertCurrent()
  const opened = await openCodexThread(
    connection,
    {
      ...launch,
      permissions: recovery?.effective ?? permissionPolicyFromOptions(Object.fromEntries(options))
    },
    timeoutMs
  )
  assertCurrent()
  if (recovery) {
    // A fallback is usable only when this acquisition confirms its effective policy.
    if (
      !opened.permissions ||
      classifyCodexPermissions(opened.permissions) !== classifyCodexPermissions(recovery.effective)
    ) {
      throw new Error('The provider did not confirm the permitted recovery policy.')
    }
    options.set(
      'permissionRecovery',
      JSON.stringify({ ...recovery, effective: opened.permissions })
    )
  }
  return opened
}
