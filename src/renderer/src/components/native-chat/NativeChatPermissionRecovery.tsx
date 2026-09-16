import { useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { translate } from '@/i18n/i18n'
import { codexPermissionLabel } from '../../../../shared/codex-permissions'
import type {
  SessionOptionDescriptor,
  SessionOptionsSurface
} from '../../../../shared/native-chat-session-options'

export function NativeChatPermissionRecovery({
  descriptor,
  surface,
  isWorking
}: {
  descriptor: SessionOptionDescriptor
  surface: SessionOptionsSurface
  isWorking: boolean
}): React.JSX.Element | null {
  const [pending, setPending] = useState(false)
  const inFlight = useRef(false)
  const recovery = descriptor.permissionState
  if (!recovery?.desired || (!recovery.restoration && recovery.current === recovery.desired)) {
    return null
  }
  const pendingSelection = descriptor.valueSource === 'dispatched' && !recovery.restoration
  const retry = async (): Promise<void> => {
    if (inFlight.current || isWorking) {
      return
    }
    inFlight.current = true
    setPending(true)
    try {
      await surface.invokeAction('permissions')
    } catch {
      // The inline status retains both permission states after a failed retry.
    } finally {
      inFlight.current = false
      setPending(false)
    }
  }
  return (
    <div
      role="status"
      className="flex min-w-0 flex-col gap-1 border-t pt-2 text-xs text-muted-foreground"
    >
      <p>
        {pendingSelection
          ? translate(
              'components.native-chat.permissions.pending',
              'Selected permissions will be applied to the next message.'
            )
          : recovery.restoration === 'restoring'
            ? translate('components.native-chat.permissions.restoring', 'Restoring permissions...')
            : translate(
                'components.native-chat.permissions.restoreFailed',
                'Selected permissions are not confirmed.'
              )}{' '}
        {translate(
          'components.native-chat.permissions.selectedAndActive',
          'Selected: {{desired}}. Active: {{current}}.',
          {
            desired: codexPermissionLabel(recovery.desired),
            current: codexPermissionLabel(recovery.current)
          }
        )}
      </p>
      {!pendingSelection && recovery.restoration !== 'restoring' && (
        <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
          <span>
            {translate(
              'components.native-chat.permissions.activeForMessages',
              'Messages use the active permissions.'
            )}
          </span>
          <Button
            variant="link"
            size="xs"
            disabled={isWorking || pending}
            onClick={() => void retry()}
          >
            {translate('components.native-chat.permissions.retry', 'Retry restoration')}
          </Button>
        </div>
      )}
    </div>
  )
}
