import { codexPermissionPolicy } from '../../shared/codex-permissions'
import { describe, expect, it } from 'vitest'
import { codexStructuredPermissionModeForSettings } from './codex-structured-permission-mode'

const BYPASS = ['--dangerously-bypass-approvals-and-sandbox']

describe('codexStructuredPermissionModeForSettings', () => {
  it('bypasses when the user has never opened Agent settings', () => {
    expect(codexStructuredPermissionModeForSettings({ agentDefaultArgs: {} })).toEqual({
      args: BYPASS,
      initialPermissions: codexPermissionPolicy('full-access')
    })
    expect(codexStructuredPermissionModeForSettings({})).toEqual({
      args: BYPASS,
      initialPermissions: codexPermissionPolicy('full-access')
    })
    expect(codexStructuredPermissionModeForSettings(null)).toEqual({
      args: BYPASS,
      initialPermissions: codexPermissionPolicy('full-access')
    })
    expect(codexStructuredPermissionModeForSettings({ agentDefaultArgs: { claude: '' } })).toEqual({
      args: BYPASS,
      initialPermissions: codexPermissionPolicy('full-access')
    })
  })

  it('bypasses when Yolo wrote the flag, alone or beside other tokens', () => {
    for (const codex of [
      '--dangerously-bypass-approvals-and-sandbox',
      '--dangerously-bypass-approvals-and-sandbox --model gpt-5.6-sol',
      '--model gpt-5.6-sol --dangerously-bypass-approvals-and-sandbox'
    ]) {
      expect(
        codexStructuredPermissionModeForSettings({ agentDefaultArgs: { codex } }),
        codex
      ).toEqual({ args: BYPASS, initialPermissions: codexPermissionPolicy('full-access') })
    }
  })

  it('leaves the approval prompts on when Manual cleared the flag', () => {
    expect(codexStructuredPermissionModeForSettings({ agentDefaultArgs: { codex: '' } })).toEqual({
      args: []
    })
  })

  // The passthrough that used to carry these to app-server is gone on purpose; only the
  // permission posture is derived, and nothing else from the field reaches argv.
  it('carries nothing but the permission posture out of the arguments field', () => {
    expect(
      codexStructuredPermissionModeForSettings({
        agentDefaultArgs: {
          codex: '--profile review --add-dir /repo -c model_reasoning_effort=high'
        }
      })
    ).toEqual({ args: [] })
  })
})
