import { appendFileSync, mkdtempSync } from 'node:fs'
import type { Page, TestInfo } from '@stablyai/playwright-test'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { runProcess } from '../../../src/shared/child-process/run-process'
import { getFirstWslDistro } from './wsl-golden-stub-agent'
import { createNativeChatWslFolders } from './native-chat-wsl-folders'

vi.mock(import('node:fs'), async (importOriginal) => ({
  ...(await importOriginal()),
  appendFileSync: vi.fn(),
  mkdtempSync: vi.fn()
}))
vi.mock('./orca-app', async () => ({ expect: (await import('vitest')).expect }))
vi.mock('./wsl-golden-stub-agent', () => ({ getFirstWslDistro: vi.fn() }))
vi.mock('../../../src/shared/child-process/run-process', () => ({ runProcess: vi.fn() }))

const guestReached = new Error('Guest boundary reached')
const distro = 'Ubuntu-24.04'
let inventory: string

// oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: The distro lookup is mocked and never reads the page.
const page = {} as Page
// oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: Only outputPath is reached before the mocked guest boundary.
const testInfo = { outputPath: () => 'wsl-filesystem.jsonl' } as TestInfo

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubGlobal('process', { ...process, platform: 'win32', env: { ...process.env } })
  vi.stubEnv('SystemRoot', 'C:\\Windows')
  vi.stubEnv('ORCA_E2E_WSL_VERSION', undefined)
  inventory = `  NAME STATE VERSION\r\n* ${distro} Running 2\r\n`
  vi.mocked(getFirstWslDistro).mockResolvedValue(distro)
  vi.mocked(mkdtempSync).mockReturnValue('/local/wsl-fixture')
  vi.mocked(runProcess).mockImplementation(async ({ program, args }) => {
    if (args?.includes('/usr/bin/uname')) {
      throw guestReached
    }
    return {
      code: 0,
      signal: null,
      stdout: program === 'git' ? 'test-revision' : inventory,
      stderr: '',
      timedOut: false,
      outputTruncated: false
    }
  })
})

afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

describe('native chat WSL folder prerequisites', () => {
  it.each(['canonical', 'legacy'] as const)(
    'requests a guest temporary path for the %s fixture without elevation',
    async (location) => {
      vi.mocked(runProcess).mockImplementation(async ({ program, args }) => {
        const denied = args?.includes('/usr/bin/mktemp') && args.at(-1)?.startsWith('/home/')
        if (args?.includes('/usr/bin/mktemp') && !denied) {
          expect(args).toEqual([
            '-d',
            distro,
            '--exec',
            '/usr/bin/mktemp',
            '-d',
            '/tmp/orca-native-chat-XXXXXX'
          ])
          throw guestReached
        }
        return {
          code: denied ? 1 : 0,
          signal: null,
          stdout: program === 'git' ? 'test-revision' : inventory,
          stderr: denied ? 'mktemp: failed to create directory under /home: Permission denied' : '',
          timedOut: false,
          outputTruncated: false
        }
      })
      await expect(createNativeChatWslFolders(page, location, testInfo, vi.fn())).rejects.toBe(
        guestReached
      )
    }
  )

  it.each(['1', '2'])('accepts WSL%s and records its observed version', async (version) => {
    inventory = `  NAME STATE VERSION\r\n* ${distro} Running ${version}\r\n`
    await expect(createNativeChatWslFolders(page, 'drive', testInfo, vi.fn())).rejects.toBe(
      guestReached
    )
    expect(appendFileSync).toHaveBeenCalledWith(
      'wsl-filesystem.jsonl',
      `${JSON.stringify({ testedSha: 'test-revision', distro, wslVersion: Number(version) })}\n`
    )
  })

  it('accepts an explicitly required WSL2 host', async () => {
    vi.stubEnv('ORCA_E2E_WSL_VERSION', '2')
    await expect(createNativeChatWslFolders(page, 'drive', testInfo, vi.fn())).rejects.toBe(
      guestReached
    )
  })

  it.each([
    { actual: '2', required: '1' },
    { actual: '1', required: '2' },
    { actual: '2', required: 'invalid' }
  ])('rejects WSL$actual when $required is required', async ({ actual, required }) => {
    inventory = `  NAME STATE VERSION\r\n* ${distro} Running ${actual}\r\n`
    vi.stubEnv('ORCA_E2E_WSL_VERSION', required)
    await expect(createNativeChatWslFolders(page, 'drive', testInfo, vi.fn())).rejects.toThrow(
      `Expected WSL${required}`
    )
    expect(runProcess).toHaveBeenCalledTimes(2)
  })

  it.each([
    `  NAME STATE VERSION\r\n* Debian Running 2\r\n`,
    `  NAME STATE VERSION\r\n* ${distro} Running 3\r\n`,
    `  NAME STATE VERSION\r\n* ${distro} Running\r\n`
  ])('rejects missing or unsupported distro version evidence', async (output) => {
    inventory = output
    await expect(createNativeChatWslFolders(page, 'drive', testInfo, vi.fn())).rejects.toThrow()
    expect(runProcess).toHaveBeenCalledTimes(2)
  })
})
