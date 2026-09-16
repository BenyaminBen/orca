import type { GlobalSettings } from '../../shared/global-settings-types'
import { resolvedTuiAgentArgsBypassPermissions } from '../../shared/tui-agent-launch-defaults'
import { YOLO_TUI_AGENT_ARGS } from '../../shared/tui-agent-permissions'
import { codexPermissionPolicy, type CodexPermissionPolicy } from '../../shared/codex-permissions'

export type CodexStructuredPermissionMode = {
  args: string[]
  initialPermissions?: CodexPermissionPolicy
}

/**
 * The resolved Agent Permissions setting as process args and an eligible new-thread default.
 *
 * Derived per acquisition from the resolved launch arguments, never from the free-text Arguments
 * field: app-server takes a narrower option set than the interactive CLI and the two are versioned
 * apart, so the only thing read out of that field is the posture the toggle stores in it. An
 * untouched profile resolves to the default Orca ships, which is the bypass flag.
 */
export function codexStructuredPermissionModeForSettings(
  settings: Partial<Pick<GlobalSettings, 'agentDefaultArgs'>> | null | undefined
): CodexStructuredPermissionMode {
  const bypassArg = YOLO_TUI_AGENT_ARGS.codex
  return bypassArg !== undefined &&
    resolvedTuiAgentArgsBypassPermissions('codex', settings?.agentDefaultArgs)
    ? { args: [bypassArg], initialPermissions: codexPermissionPolicy('full-access') }
    : { args: [] }
}
