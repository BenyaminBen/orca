import {
  appendFileSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import type { Page, TestInfo } from '@stablyai/playwright-test'
import { expect } from './orca-app'
import { getFirstWslDistro } from './wsl-golden-stub-agent'
import { runProcess } from '../../../src/shared/child-process/run-process'
import { buildWslExecArgs } from '../../../src/shared/wsl-login-shell-command'
import { toLinuxPath, toWindowsWslPath, toWindowsWslUncPath } from '../../../src/shared/wsl-paths'

export type WslFolderLocation = 'canonical' | 'legacy' | 'drive'
export const SELECTED_FOLDER = 'Internal folder/Nested folder'
export const CHILD_FILE = 'wsl-folder-proof.txt'

export async function createNativeChatWslFolders(
  page: Page,
  location: WslFolderLocation,
  testInfo: TestInfo,
  registerCleanup: (cleanup: () => Promise<void>) => void
) {
  expect(process.platform, 'Real Windows is required').toBe('win32')
  const evidencePath = testInfo.outputPath('wsl-filesystem.jsonl')
  const record = (value: unknown): void => {
    appendFileSync(evidencePath, `${JSON.stringify(value)}\n`)
  }
  record({
    platform: process.platform,
    runnerImage: process.env.ImageOS,
    runnerImageVersion: process.env.ImageVersion,
    workflowHead: process.env.GITHUB_SHA
  })
  const execute = async (program: string, args: string[]): Promise<string> => {
    const result = await runProcess({ program, args, timeoutMs: 30_000 })
    record({ program, args, ...result })
    expect(result.code, `${program} ${args.join(' ')}: ${result.stderr}`).toBe(0)
    expect(result.timedOut).toBe(false)
    expect(result.outputTruncated).toBe(false)
    return result.stdout.replace(/\0/g, '').trim()
  }
  const testedSha = await execute('git', ['rev-parse', 'HEAD'])
  if (!process.env.SystemRoot) {
    throw new Error('Windows SystemRoot is unavailable')
  }
  const wsl = path.join(process.env.SystemRoot, 'System32', 'wsl.exe')
  const inventory = await execute(wsl, ['--list', '--verbose'])
  const distro = await getFirstWslDistro(page)
  if (!distro) {
    throw new Error('Provisioned WSL distro is unavailable through Orca IPC')
  }
  const row = inventory
    .split(/\r?\n/)
    .map((line) =>
      line
        .trim()
        .replace(/^\*\s*/, '')
        .split(/\s+/)
    )
    .find((parts) => parts[0] === distro)
  expect(row?.at(-1), `Expected WSL1 for ${distro}: ${inventory}`).toBe('1')
  const guest = (args: string[]): Promise<string> => execute(wsl, buildWslExecArgs(distro, args))
  await guest(['/usr/bin/uname', '-a'])
  await guest(['/usr/bin/cat', '/etc/os-release'])

  const localRoot = mkdtempSync(path.join(tmpdir(), 'orca-native-chat-wsl-'))
  registerCleanup(async () => rmSync(localRoot, { recursive: true, force: true }))
  const linuxRoot =
    location === 'drive'
      ? toLinuxPath(realpathSync.native(localRoot))
      : await guest(['/usr/bin/mktemp', '-d', '/home/orca-native-chat-XXXXXX'])
  record({ localRoot, linuxRoot })
  if (location === 'drive') {
    expect(linuxRoot).toMatch(/^\/mnt\/[a-z]\//)
  } else {
    registerCleanup(async () => {
      await guest(['/usr/bin/rm', '-rf', '--', linuxRoot])
    })
  }
  const driveWorkspace =
    location === 'drive'
      ? await page.evaluate(() => {
          const state = window.__store!.getState()
          const worktree = Object.values(state.worktreesByRepo)
            .flat()
            .find((entry) => entry.id === state.activeWorktreeId)
          if (!worktree) {
            throw new Error('Seeded drive worktree is unavailable')
          }
          return worktree.path
        })
      : null
  const linuxWorkspace = driveWorkspace
    ? toLinuxPath(realpathSync.native(driveWorkspace))
    : path.posix.join(linuxRoot, 'workspace')
  if (driveWorkspace) {
    expect(linuxWorkspace).toMatch(/^\/mnt\/[a-z]\//)
    const ownedFolder = path.join(driveWorkspace, SELECTED_FOLDER.split('/')[0])
    expect(existsSync(ownedFolder), 'The fixture must own its new folder').toBe(false)
    registerCleanup(async () => rmSync(ownedFolder, { recursive: true, force: true }))
  }
  const internalFolder = path.posix.join(linuxWorkspace, SELECTED_FOLDER)
  const outsideFolder = path.posix.join(linuxRoot, 'workspace-other', 'Outside folder')
  await guest(['/usr/bin/mkdir', '-p', internalFolder, outsideFolder])
  const canonicalRoot = toWindowsWslUncPath(linuxWorkspace, distro)
  const legacyRoot = canonicalRoot.replace('\\\\wsl.localhost\\', '\\\\wsl$\\')
  const workspacePath = driveWorkspace ?? (location === 'legacy' ? legacyRoot : canonicalRoot)
  const content = 'Real WSL folder enumeration\n'
  // Windows drive files use their native path; Linux files use the WSL share.
  for (const folder of [internalFolder, outsideFolder]) {
    const fixturePath = path.win32.join(toWindowsWslPath(folder, distro), CHILD_FILE)
    writeFileSync(fixturePath, content)
    record({ createdFile: fixturePath })
  }
  const windowsReadRoots = driveWorkspace ? [driveWorkspace] : [canonicalRoot, legacyRoot]
  for (const root of windowsReadRoots) {
    expect(readFileSync(path.win32.join(root, SELECTED_FOLDER, CHILD_FILE), 'utf8')).toBe(content)
  }
  expect(await guest(['/usr/bin/cat', path.posix.join(internalFolder, CHILD_FILE)])).toBe(
    content.trim()
  )
  expect(await guest(['/usr/bin/cat', path.posix.join(outsideFolder, CHILD_FILE)])).toBe(
    content.trim()
  )
  record({
    testedSha,
    distro,
    wslVersion: 1,
    workspacePath,
    internalFolder,
    outsideFolder,
    windowsReadRoots
  })
  return { localRoot, workspacePath, internalFolder, outsideFolder, distro }
}
