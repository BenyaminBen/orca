import { randomUUID } from 'node:crypto'
import { writeFileSync } from 'node:fs'
import path from 'node:path'
import type { Page } from '@stablyai/playwright-test'
import { test, expect } from './helpers/orca-app'
import { waitForSessionReady, ensureTerminalVisible } from './helpers/store'
import { waitForActivePaneHookDescriptor } from './helpers/terminal-active-pane'
import { useWslRuntimeForActiveProject as configureWslRuntimeForActiveProject } from './helpers/wsl-golden-stub-agent'
import {
  CHILD_FILE,
  SELECTED_FOLDER,
  createNativeChatWslFolders,
  type WslFolderLocation
} from './helpers/native-chat-wsl-folders'

const folderTest = test.extend({ seedTestRepo: false })
test.skip(process.platform !== 'win32', 'Requires a real Windows WSL1 host')

async function seedFolderChat(
  page: Page,
  folders: Awaited<ReturnType<typeof createNativeChatWslFolders>>,
  location: WslFolderLocation
): Promise<string> {
  const sessionId = randomUUID()
  const transcriptPath = path.join(folders.localRoot, `${sessionId}.jsonl`)
  writeFileSync(
    transcriptPath,
    `${['user', 'assistant']
      .map((role, index) =>
        JSON.stringify({
          sessionId,
          uuid: randomUUID(),
          timestamp: new Date(Date.now() - (1 - index) * 1000).toISOString(),
          type: role,
          message: {
            role,
            content: [
              {
                type: 'text',
                text:
                  role === 'user'
                    ? 'Show the workspace folders.'
                    : `Open [internal folder](<${folders.internalFolder}>) or [outside folder](<${folders.outsideFolder}>).`
              }
            ]
          }
        })
      )
      .join('\n')}\n`
  )
  const workspaceId = await page.evaluate(
    async ({ folderPath, location }) => {
      const state = window.__store!.getState()
      await state.updateSettingsOrThrow({
        experimentalNativeChat: true,
        terminalLinkActionPopoverEnabled: true
      })
      if (location === 'drive') {
        if (!state.activeWorktreeId) {
          throw new Error('Seeded drive worktree is not active')
        }
        return state.activeWorktreeId
      }
      const group = await window.api.projectGroups.create({
        name: 'WSL folder links',
        parentPath: folderPath,
        createdFrom: 'manual'
      })
      if (!group) {
        throw new Error('Folder project group was not created')
      }
      await state.fetchProjectGroups()
      const workspace = await state.createFolderWorkspace({
        projectGroupId: group.id,
        name: 'WSL workspace',
        folderPath
      })
      if (!workspace) {
        throw new Error('Folder workspace was not created')
      }
      const id = `folder:${workspace.id}`
      state.setActiveWorktree(id)
      if (!window.__store!.getState().tabsByWorktree[id]?.length) {
        state.createTab(id)
      }
      return id
    },
    { folderPath: folders.workspacePath, location }
  )
  if (location === 'drive') {
    await configureWslRuntimeForActiveProject(page, folders.distro)
    await page.evaluate((id) => window.__store!.getState().createTab(id), workspaceId)
  }
  await ensureTerminalVisible(page)
  const descriptor = await waitForActivePaneHookDescriptor(page)
  expect(descriptor.worktreeId).toBe(workspaceId)
  await page.evaluate(
    ({ descriptor, sessionId, transcriptPath }) => {
      const state = window.__store!.getState()
      state.setAgentStatus(
        descriptor.paneKey,
        { state: 'working', prompt: 'Folder links', agentType: 'claude' },
        'Claude',
        undefined,
        { worktreeId: descriptor.worktreeId },
        { providerSession: { key: 'session_id', id: sessionId, transcriptPath } }
      )
      const tab = (state.unifiedTabsByWorktree[descriptor.worktreeId] ?? []).find(
        (entry) =>
          entry.contentType === 'terminal' && entry.entityId === descriptor.paneKey.split(':')[0]
      )
      if (!tab) {
        throw new Error('Terminal tab unavailable')
      }
      state.toggleTabViewMode(tab.id)
    },
    { descriptor, sessionId, transcriptPath }
  )
  await expect(page.locator('[data-native-chat-root="true"]')).toBeVisible()
  return workspaceId
}

const scenarios: { title: string; location: WslFolderLocation; reject?: boolean }[] = [
  { title: 'WSL native chat opens a folder under the canonical share', location: 'canonical' },
  { title: 'WSL native chat opens a folder under the legacy share', location: 'legacy' },
  {
    title: 'WSL native chat opens a Windows drive folder in a WSL project',
    location: 'drive',
    reject: true
  },
  {
    title: 'WSL native chat rejects an existing folder outside the workspace',
    location: 'canonical',
    reject: true
  }
]

for (const scenario of scenarios) {
  const scenarioTest = scenario.location === 'drive' ? test : folderTest
  scenarioTest(
    scenario.title,
    async ({ orcaPage: page, electronApp, registerPostElectronShutdownCleanup }, testInfo) => {
      await waitForSessionReady(page)
      await page.setViewportSize({ width: 1440, height: 1000 })
      // Observe OS handoffs without replacing their behavior or any filesystem/IPC operation.
      const externalCalls = await electronApp.evaluateHandle(({ shell }) => {
        const calls: string[] = []
        const { openPath, openExternal, showItemInFolder } = shell
        shell.openPath = (...args) => {
          calls.push('openPath')
          return openPath(...args)
        }
        shell.openExternal = (...args) => {
          calls.push('openExternal')
          return openExternal(...args)
        }
        shell.showItemInFolder = (...args) => {
          calls.push('showItemInFolder')
          return showItemInFolder(...args)
        }
        return calls
      })
      try {
        const folders = await createNativeChatWslFolders(
          page,
          scenario.location,
          testInfo,
          registerPostElectronShutdownCleanup
        )
        const workspaceId = await seedFolderChat(page, folders, scenario.location)
        // Preserve the stored root spelling, including the legacy share alias.
        expect(
          await page.evaluate((id) => {
            const state = window.__store!.getState()
            return (
              state.folderWorkspaces.find((workspace) => `folder:${workspace.id}` === id)
                ?.folderPath ??
              Object.values(state.worktreesByRepo)
                .flat()
                .find((worktree) => worktree.id === id)?.path
            )
          }, workspaceId)
        ).toBe(folders.workspacePath)
        await page.getByRole('link', { name: 'internal folder', exact: true }).click()
        await page.getByRole('button', { name: /^Open in Orca/ }).click()
        const explorer = page.locator('[data-orca-explorer-shell]')
        const folderRow = explorer.getByRole('button', { name: 'Nested folder', exact: true })
        await expect(explorer).toHaveAttribute(
          'data-selected-folder-relative-path',
          SELECTED_FOLDER
        )
        await expect(folderRow).toBeVisible()
        await expect(folderRow).toHaveAttribute('data-selected', 'true')
        await expect(folderRow).toHaveAttribute(
          'data-native-file-drop-dir',
          path.join(folders.workspacePath, SELECTED_FOLDER)
        )
        await folderRow.click()
        await expect(explorer.getByRole('button', { name: CHILD_FILE, exact: true })).toBeVisible()
        if (scenario.reject) {
          await page.getByRole('link', { name: 'outside folder', exact: true }).click()
          await page.getByRole('button', { name: /^Open in Orca/ }).click()
          await expect(
            page.getByText(
              'This folder is outside the current workspace. Use the file manager to open it.',
              { exact: true }
            )
          ).toBeVisible()
          await expect(explorer).toHaveAttribute(
            'data-selected-folder-relative-path',
            SELECTED_FOLDER
          )
          await expect(folderRow).toHaveAttribute('data-selected', 'true')
          await expect(
            explorer.getByRole('button', { name: CHILD_FILE, exact: true })
          ).toBeVisible()
          await expect(
            explorer.getByRole('button', { name: 'Outside folder', exact: true })
          ).toHaveCount(0)
        }
        expect(await externalCalls.jsonValue()).toEqual([])
        const screenshot = testInfo.outputPath('folder-destination-success.png')
        await page.mouse.move(800, 400)
        await page.screenshot({ path: screenshot, animations: 'disabled' })
        await testInfo.attach('folder-destination-success', {
          path: screenshot,
          contentType: 'image/png'
        })
      } catch (error) {
        await page
          .screenshot({
            path: testInfo.outputPath('folder-destination-failure.png'),
            animations: 'disabled'
          })
          .catch(() => {})
        throw error
      }
    }
  )
}
