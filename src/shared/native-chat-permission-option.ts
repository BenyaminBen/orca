import { CODEX_PERMISSION_MODES, type CodexPermissionOptions } from './codex-permissions'
import type {
  SessionOptionDescriptor,
  NativeChatLiveOptionTransport
} from './native-chat-session-options'

export function nativeChatPermissionOption(
  permissions: CodexPermissionOptions,
  transport: NativeChatLiveOptionTransport
): SessionOptionDescriptor {
  return {
    id: 'permissions',
    label: 'Permissions',
    category: 'permissions',
    permissionState: {
      current: permissions.current,
      desired: permissions.desired,
      restoration: permissions.restoration
    },
    kind: {
      type: 'select',
      currentValue: permissions.pending ?? permissions.current,
      choices: CODEX_PERMISSION_MODES.map((mode) => {
        const hostChoice = permissions.choices.find((choice) => choice.value === mode.value)
        return {
          ...mode,
          disabledReason: hostChoice
            ? hostChoice.disabledReason
            : 'This version does not support this permission mode.'
        }
      })
    },
    valueSource: permissions.pending ? 'dispatched' : permissions.current ? 'reported' : 'unknown',
    transport,
    settable: permissions.choices.some((choice) => !choice.disabledReason)
  }
}
