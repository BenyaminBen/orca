import { useRef, useState } from 'react'
import { toast } from 'sonner'
import { useConfirmationDialog } from '@/components/confirmation-dialog-context'
import { persistConfirmationSkipPreference } from '@/components/confirmation-skip-preference'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem
} from '@/components/ui/dropdown-menu'
import { useAppStore } from '@/store'
import { translate } from '@/i18n/i18n'
import { codexPermissionLabel, isCodexPermissionMode } from '../../../../shared/codex-permissions'
import type {
  SessionOptionDescriptor,
  SessionOptionsSurface
} from '../../../../shared/native-chat-session-options'
import { PickerTrigger } from './NativeChatOptionPickerTrigger'

export function NativeChatPermissionPicker(props: {
  surface: SessionOptionsSurface
  descriptor: SessionOptionDescriptor
  isWorking: boolean
}): React.JSX.Element | null {
  const confirm = useConfirmationDialog()
  const settings = useAppStore((state) => state.settings)
  const updateSettings = useAppStore((state) => state.updateSettings)
  const openSettingsPage = useAppStore((state) => state.openSettingsPage)
  const openSettingsTarget = useAppStore((state) => state.openSettingsTarget)
  const [pending, setPending] = useState(false)
  const inFlight = useRef(false)
  const latest = useRef(props)
  latest.current = props
  const { descriptor, surface, isWorking } = props
  if (descriptor.kind.type !== 'select') {
    return null
  }
  const current = descriptor.kind.currentValue
  const selected = descriptor.permissionState?.desired ?? current
  const label =
    isCodexPermissionMode(current) || current === 'read-only' || current === 'custom'
      ? codexPermissionLabel(current)
      : translate('components.native-chat.permissions.unknownLabel', 'Unknown')
  const setMode = async (value: string): Promise<void> => {
    if (inFlight.current || isWorking || !isCodexPermissionMode(value) || value === selected) {
      return
    }
    inFlight.current = true
    setPending(true)
    try {
      if (value === 'full-access' && !settings?.skipFullAccessConfirm) {
        const accepted = await confirm({
          title: translate(
            'components.native-chat.permissions.confirmTitle',
            'Enable full access?'
          ),
          description: translate(
            'components.native-chat.permissions.confirmDescription',
            'Allow this chat to run commands without sandbox restrictions or approval, including network access.'
          ),
          confirmLabel: translate(
            'components.native-chat.permissions.confirm',
            'Enable full access'
          ),
          dontAskAgain: {
            onConfirmed: () =>
              persistConfirmationSkipPreference({
                updates: { skipFullAccessConfirm: true },
                settingsSectionId: 'general-full-access-confirm',
                updateSettings,
                openSettingsPage,
                openSettingsTarget
              })
          }
        })
        if (!accepted) {
          return
        }
      }
      if (latest.current.surface !== surface || latest.current.isWorking) {
        throw new Error(
          'The chat changed while the confirmation was open. Try again when it is idle.'
        )
      }
      await surface.setOption('permissions', value)
    } catch (error) {
      toast.error(
        translate(
          'components.native-chat.permissions.updateFailed',
          'Could not update permissions'
        ),
        {
          description: error instanceof Error ? error.message : String(error)
        }
      )
    } finally {
      inFlight.current = false
      setPending(false)
    }
  }
  return (
    <DropdownMenu>
      <PickerTrigger
        label={label}
        tooltipLabel={translate('components.native-chat.permissions.label', 'Permissions')}
        disabled={isWorking || pending}
        bold={current === 'full-access'}
        dispatched={false}
        status={
          descriptor.valueSource === 'dispatched'
            ? translate(
                'components.native-chat.permissions.nextMessage',
                'Applies to the next message; awaiting confirmation.'
              )
            : current === 'custom'
              ? translate(
                  'components.native-chat.permissions.custom',
                  'Custom permissions detected.'
                )
              : descriptor.valueSource === 'unknown'
                ? translate(
                    'components.native-chat.permissions.unknown',
                    'Current permissions have not been reported.'
                  )
                : undefined
        }
      />
      <DropdownMenuContent align="start" side="top" collisionPadding={8} className="w-64">
        <DropdownMenuRadioGroup
          aria-label={translate('components.native-chat.permissions.label', 'Permissions')}
          value={selected}
          onValueChange={(value) => void setMode(value)}
        >
          {descriptor.kind.choices.map((choice) => (
            <DropdownMenuRadioItem
              key={choice.value}
              value={choice.value}
              disabled={isWorking || pending || !descriptor.settable || !!choice.disabledReason}
            >
              <div className="min-w-0 py-0.5">
                <div className={choice.value === 'full-access' ? 'font-bold' : undefined}>
                  {choice.label}
                </div>
                <div className="text-xs font-normal text-muted-foreground">
                  {choice.disabledReason ?? choice.description}
                </div>
              </div>
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
