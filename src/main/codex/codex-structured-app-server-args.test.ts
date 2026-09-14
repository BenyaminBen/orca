import { describe, expect, it } from 'vitest'
import { resolveCodexStructuredAppServerArgs } from './codex-structured-app-server-args'

describe('structured Codex app-server arguments', () => {
  it.each(['--dangerously-bypass-approvals-and-sandbox', '--yolo'])(
    'translates %s into policies applied to app-server threads',
    (configured) => {
      expect(resolveCodexStructuredAppServerArgs(configured, 'posix')).toEqual([
        '-c',
        'approval_policy=never',
        '-c',
        'sandbox_mode=danger-full-access'
      ])
    }
  )

  it('translates approval and sandbox flags into app-server config overrides', () => {
    expect(
      resolveCodexStructuredAppServerArgs('--ask-for-approval never -s workspace-write', 'posix')
    ).toEqual(['-c', 'approval_policy=never', '-c', 'sandbox_mode=workspace-write'])
  })

  it('keeps configuration flags and converts effort to the app-server config contract', () => {
    expect(
      resolveCodexStructuredAppServerArgs(
        '--profile review -c approval_policy=never --model gpt-5.6 --effort high --search',
        'posix'
      )
    ).toEqual([
      '--profile',
      'review',
      '-c',
      'approval_policy=never',
      '--model',
      'gpt-5.6',
      '-c',
      'model_reasoning_effort=high',
      '--search'
    ])
  })

  it.each(['--no-alt-screen', '--remote ws://host', '-C /tmp/elsewhere', 'resume thread-1'])(
    'reports an incompatible configured argument instead of dropping %s',
    (configured) => {
      expect(() => resolveCodexStructuredAppServerArgs(configured, 'posix')).toThrow(
        /cannot apply the configured CLI arguments.*Settings or use terminal view/
      )
    }
  )
})
