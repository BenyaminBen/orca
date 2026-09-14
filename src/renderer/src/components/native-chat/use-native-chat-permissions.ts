import { useEffect } from 'react'
import { readCodexPermissionScreen } from '../../../../shared/codex-permission-menu'
import {
  CODEX_PERMISSION_MODES,
  type CodexPermissionOptions
} from '../../../../shared/codex-permissions'
import type { NativeChatPtySessionOptionsSurface } from './native-chat-pty-session-options'
import type { NativeChatSessionOptionDispatchCommand } from './native-chat-session-option-command-dispatch'

export function useNativeChatPermissions(args: {
  enabled: boolean
  disabled: boolean
  surface: NativeChatPtySessionOptionsSurface | null
  readTerminalScreen?: () => string | null
  dispatchCommand: NativeChatSessionOptionDispatchCommand
}): void {
  const { enabled, disabled, surface, readTerminalScreen, dispatchCommand } = args
  useEffect(() => {
    if (!enabled || !surface || !readTerminalScreen) {
      return
    }
    let canceled = false
    let probing = false
    let probed = false
    let current: CodexPermissionOptions = {
      choices: CODEX_PERMISSION_MODES.map(({ value }) => ({
        value,
        disabledReason: 'Waiting for the CLI permission menu.'
      }))
    }
    const refresh = (): void => {
      if (canceled || probing) {
        return
      }
      const screen = readTerminalScreen()
      if (screen === null) {
        return
      }
      const observed = readCodexPermissionScreen(screen)
      if (observed.menu || observed.current) {
        current = observed.menu ?? { ...current, current: observed.current }
        surface.reportPermissions(current)
      }
      if (disabled || probed || !observed.emptyComposer) {
        return
      }
      probing = true
      probed = true
      void Promise.resolve(dispatchCommand('/permissions', { permissions: 'read' }))
        .then((result) => {
          if (!canceled && result?.permissions) {
            current = result.permissions
            surface.reportPermissions(current)
          }
        })
        .catch((error) => {
          if (!canceled) {
            current = {
              ...current,
              choices: CODEX_PERMISSION_MODES.map(({ value }) => ({
                value,
                disabledReason:
                  error instanceof Error ? error.message : 'Could not read the CLI permission menu.'
              }))
            }
            surface.reportPermissions(current)
          }
        })
        .finally(() => {
          probing = false
        })
    }
    refresh()
    const timer = setInterval(refresh, 500)
    return () => {
      canceled = true
      clearInterval(timer)
    }
  }, [enabled, disabled, surface, readTerminalScreen, dispatchCommand])
}
