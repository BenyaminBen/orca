import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { Terminal } from '@xterm/headless'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import {
  clearCodexConversationKeepingPermissions,
  readCodexPermissionScreen,
  runCodexPermissionMenu
} from './codex-permission-menu'

const screens: string[] = []
beforeAll(async () => {
  for (const name of ['codex-permissions-0.154.raw.txt', 'codex-permission-clear-0.154.raw.txt']) {
    const raw = await readFile(join(__dirname, '__fixtures__', name), 'utf8')
    const terminal = new Terminal({ cols: 120, rows: 40, allowProposedApi: true, scrollback: 1000 })
    try {
      for (const frame of raw.split('\u001b[?2026l')) {
        await new Promise<void>((resolve) => terminal.write(frame, resolve))
        const buffer = terminal.buffer.active
        screens.push(
          Array.from(
            { length: terminal.rows },
            (_, index) => buffer.getLine(buffer.baseY + index)?.translateToString(true) ?? ''
          ).join('\n')
        )
      }
    } finally {
      terminal.dispose()
    }
  }
})

function captured(
  predicate: (state: ReturnType<typeof readCodexPermissionScreen>) => boolean
): string {
  const screen = screens.find((screen) => predicate(readCodexPermissionScreen(screen)))
  if (!screen) {
    throw new Error('The required screen was not present in the captured transcript.')
  }
  return screen
}

describe('captured permission menu', () => {
  it('reads the current marker independently of the keyboard cursor', () => {
    const screen = captured((state) => state.menu?.current === 'ask-for-approval')
    const state = readCodexPermissionScreen(screen)
    expect(state.menu?.choices).toHaveLength(3)
    expect(state.rows).toEqual([
      { mode: 'ask-for-approval', key: '1' },
      { mode: 'approve-for-me', key: '2' },
      { mode: 'full-access', key: '3' }
    ])
  })

  it('recognizes the real Full Access confirmation and all three success echoes', () => {
    expect(captured((state) => state.confirmation)).toBeTruthy()
    for (const mode of ['ask-for-approval', 'approve-for-me', 'full-access']) {
      expect(
        captured((state) => !state.menu && state.emptyComposer && state.current === mode)
      ).toBeTruthy()
    }
    expect(captured((state) => state.current === 'custom')).toContain(
      'Custom (custom permissions, Approve for me)'
    )
  })

  it('queries without selecting anything', async () => {
    const idle = captured((state) => state.emptyComposer && !state.current)
    const menu = captured((state) => state.menu?.current === 'ask-for-approval')
    const command = captured((state) => state.composerText === '/permissions')
    let screen = idle
    const write = vi.fn(async (key: string) => {
      if (key === 's') {
        screen = command
      }
      if (key === '\r') {
        screen = menu
      }
      if (key === '\u001b') {
        screen = idle
      }
      return true
    })
    expect((await runCodexPermissionMenu({ readScreen: () => screen, write })).current).toBe(
      'ask-for-approval'
    )
    expect(write.mock.calls.map(([key]) => key).join('')).toContain('/permissions\r\u001b')
    expect(write.mock.calls.some(([key]) => ['1', '2', '3'].includes(key))).toBe(false)
  })

  it('confirms Full Access once, then waits for the actual success screen', async () => {
    let screen = captured((state) => state.menu?.current === 'ask-for-approval')
    const confirmation = captured((state) => state.confirmation)
    const applied = captured((state) => state.emptyComposer && state.current === 'full-access')
    const write = vi.fn(async (key: string) => {
      if (key === '3') {
        screen = confirmation
      }
      if (key === '\r') {
        screen = applied
      }
      return true
    })
    await expect(
      runCodexPermissionMenu({ readScreen: () => screen, write, mode: 'full-access' })
    ).resolves.toMatchObject({ current: 'full-access' })
    expect(write.mock.calls).toEqual([['3'], ['\r']])
  })

  it('does not overwrite a typed draft or confirm after cancellation', async () => {
    const write = vi.fn(async () => true)
    await expect(
      runCodexPermissionMenu({ readScreen: () => '› keep this draft', write, mode: 'full-access' })
    ).rejects.toThrow('terminal input')
    const controller = new AbortController()
    controller.abort()
    await expect(
      runCodexPermissionMenu({
        readScreen: () => screens[0]!,
        write,
        mode: 'full-access',
        signal: controller.signal
      })
    ).rejects.toThrow('canceled')
    expect(write).not.toHaveBeenCalled()
  })

  it('does not equate an accepted write with a permission change', async () => {
    const menu = captured((state) => state.menu?.current === 'ask-for-approval')
    const write = vi.fn(async () => true)
    await expect(
      runCodexPermissionMenu({ readScreen: () => menu, write, mode: 'full-access', timeoutMs: 30 })
    ).rejects.toThrow('did not confirm')
    expect(write.mock.calls).toEqual([['3'], ['\u001b']])
  })

  it('waits for the typed command to drain before submitting Enter', async () => {
    const idle = captured((state) => state.emptyComposer && !state.current)
    const menu = captured((state) => state.menu?.current === 'ask-for-approval')
    const command = captured((state) => state.composerText === '/permissions')
    let screen = idle
    let typed = ''
    let drained = false
    const write = async (key: string) => {
      typed += key
      if (typed.endsWith('/permissions')) {
        setTimeout(() => {
          drained = true
          screen = command
        }, 120)
      }
      if (key === '\r') {
        expect(drained).toBe(true)
        screen = menu
      }
      if (key === '\u001b') {
        screen = idle
      }
      return true
    }
    await expect(
      runCodexPermissionMenu({ readScreen: () => screen, write })
    ).resolves.toMatchObject({ current: 'ask-for-approval' })
  })

  it('restores the active mode when clear resets the CLI to its startup defaults', async () => {
    const idle = (current: string) =>
      captured((state) => state.emptyComposer && state.current === current)
    const menu = (current: string) => captured((state) => state.menu?.current === current)
    let screen = menu('approve-for-me')
    let cleared = false
    let typed = ''
    const write = async (key: string) => {
      if (key === '\u0015') {
        typed = ''
      } else if (key === '\u001b') {
        screen = idle(cleared ? 'ask-for-approval' : 'approve-for-me')
      } else if (key === '\r') {
        if (typed === '/clear') {
          cleared = true
          screen = idle('ask-for-approval')
        } else {
          screen = menu('ask-for-approval')
        }
      } else if (key === '2' && readCodexPermissionScreen(screen).menu) {
        screen = idle('approve-for-me')
      } else {
        typed += key
        if (typed === '/clear' || typed === '/permissions') {
          screen = captured((state) => state.composerText === typed)
        }
      }
      return true
    }
    await expect(
      clearCodexConversationKeepingPermissions({ readScreen: () => screen, write })
    ).resolves.toMatchObject({ current: 'approve-for-me' })
    expect(cleared).toBe(true)
  })
})
