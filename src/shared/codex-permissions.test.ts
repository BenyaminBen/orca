import { describe, expect, it } from 'vitest'
import {
  classifyCodexPermissions,
  codexPermissionPolicy,
  decodeCodexPermissionPolicy,
  readCodexPermissionPolicy
} from './codex-permissions'
import {
  codexPermissionThreadOverrides,
  removeCodexPermissionArgs
} from './codex-permission-launch'
import { resolveAgentSessionOptionLaunch } from './agent-session-option-launch'

describe('conversation permissions', () => {
  it.each(['ask-for-approval', 'approve-for-me', 'full-access'] as const)(
    'recognizes the complete %s policy',
    (mode) => {
      expect(classifyCodexPermissions(codexPermissionPolicy(mode))).toBe(mode)
      expect(decodeCodexPermissionPolicy(JSON.stringify(codexPermissionPolicy(mode)))).toEqual(
        codexPermissionPolicy(mode)
      )
    }
  )

  it('does not call an unrestricted sandbox Full Access when approvals are still required', () => {
    expect(
      classifyCodexPermissions({
        ...codexPermissionPolicy('full-access'),
        approvalPolicy: 'on-request'
      })
    ).toBe('custom')
  })

  it('keeps additional writable roots, enabled network, and unknown reviewers custom', () => {
    const base = codexPermissionPolicy('ask-for-approval')
    for (const sandboxPolicy of [
      { ...base.sandboxPolicy, writableRoots: ['/outside'] },
      { ...base.sandboxPolicy, networkAccess: true }
    ]) {
      expect(classifyCodexPermissions({ ...base, sandboxPolicy })).toBe('custom')
    }
    expect(classifyCodexPermissions({ ...base, approvalsReviewer: undefined })).toBe('custom')
    expect(
      classifyCodexPermissions({
        ...base,
        sandboxPolicy: { type: 'readOnly', networkAccess: false }
      })
    ).toBe('read-only')
  })

  it('does not substitute defaults for an absent or malformed report', () => {
    expect(readCodexPermissionPolicy({})).toBeUndefined()
    expect(
      readCodexPermissionPolicy({ approvalPolicy: 'never', sandbox: 'danger-full-access' })
    ).toBeUndefined()
    expect(decodeCodexPermissionPolicy('{broken')).toBeUndefined()
  })

  it('builds atomic startup overrides for a cleared conversation', () => {
    expect(codexPermissionThreadOverrides(codexPermissionPolicy('approve-for-me'))).toMatchObject({
      approvalPolicy: 'on-request',
      approvalsReviewer: 'auto_review',
      sandbox: 'workspace-write',
      config: { 'sandbox_workspace_write.network_access': false }
    })
  })

  it('transfers permissions without needing a model selection or changing launch defaults', () => {
    const values = { permissions: 'ask-for-approval' }
    const launch = resolveAgentSessionOptionLaunch('codex', values)
    expect(launch.args).toContain('approval_policy="on-request"')
    expect(launch.args).toContain('sandbox_mode="workspace-write"')
    expect(values).toEqual({ permissions: 'ask-for-approval' })
    expect(resolveAgentSessionOptionLaunch('claude', values).args).toEqual([])
  })

  it('removes conflicting flags without dropping unrelated settings or positional arguments', () => {
    expect(
      removeCodexPermissionArgs([
        '--yolo',
        '-m',
        'model',
        '-c',
        'sandbox_mode=read-only',
        '--sandbox=workspace-write',
        '--approve-for-me',
        '-c',
        'model_reasoning_effort=high'
      ])
    ).toEqual(['-m', 'model', '-c', 'model_reasoning_effort=high'])
  })
  it('preserves literal arguments after the option terminator', () => {
    expect(removeCodexPermissionArgs(['--yolo', '--', '--sandbox=read-only', '--yolo'])).toEqual([
      '--',
      '--sandbox=read-only',
      '--yolo'
    ])
  })
})
