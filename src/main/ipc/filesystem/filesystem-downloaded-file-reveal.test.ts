import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { registerFilesystemDownloadHandlers } from './filesystem-download-handlers'

const { handlers, showSaveDialog, showItemInFolder } = vi.hoisted(() => ({
  handlers: new Map<string, (event: unknown, args: unknown) => Promise<unknown>>(),
  showSaveDialog: vi.fn(),
  showItemInFolder: vi.fn()
}))

vi.mock('electron', () => ({
  BrowserWindow: { fromWebContents: () => null },
  dialog: { showSaveDialog },
  shell: { showItemInFolder },
  ipcMain: {
    handle: (channel: string, handler: (event: unknown, args: unknown) => Promise<unknown>) =>
      handlers.set(channel, handler)
  }
}))

let directory: string
let destination: string
beforeEach(async () => {
  vi.resetAllMocks()
  handlers.clear()
  directory = await mkdtemp(join(tmpdir(), 'orca-download-reveal-'))
  destination = join(directory, 'report.txt')
  showSaveDialog.mockResolvedValue({ canceled: false, filePath: destination })
  registerFilesystemDownloadHandlers({
    downloadSessions: new Map(),
    closeDownloadSession: vi.fn(async () => null),
    cleanupDownloadSessionsForSender: vi.fn()
  })
})
afterEach(async () => {
  await rm(directory, { recursive: true, force: true })
})

function save(postDownloadAction?: string) {
  return handlers.get('fs:saveDownloadedFile')!(
    { sender: {} },
    {
      suggestedName: 'report.txt',
      content: 'downloaded content',
      encoding: 'utf8',
      postDownloadAction
    }
  )
}

describe('revealing a completed local download', () => {
  it('reveals the committed destination without routing it through the active remote host', async () => {
    showItemInFolder.mockImplementation((path: string) => {
      expect(path).toBe(destination)
    })
    await expect(save('reveal')).resolves.toEqual({ canceled: false, destinationPath: destination })
    expect(showItemInFolder).toHaveBeenCalledOnce()
    expect(await readFile(destination, 'utf8')).toBe('downloaded content')
    expect(await readdir(directory)).toEqual(['report.txt'])
  })

  it('keeps the saved file when the operating system cannot reveal it', async () => {
    showItemInFolder.mockImplementation(() => {
      throw new Error('reveal failed')
    })
    await expect(save('reveal')).rejects.toThrow('reveal failed')
    expect(await readFile(destination, 'utf8')).toBe('downloaded content')
    expect(await readdir(directory)).toEqual(['report.txt'])
  })

  it('does not reveal a canceled download', async () => {
    showSaveDialog.mockResolvedValue({ canceled: true })
    await expect(save('reveal')).resolves.toEqual({ canceled: true })
    expect(showItemInFolder).not.toHaveBeenCalled()
    expect(await readdir(directory)).toEqual([])
  })

  it('preserves downloads without a post-download action', async () => {
    await expect(save()).resolves.toEqual({ canceled: false, destinationPath: destination })
    expect(showItemInFolder).not.toHaveBeenCalled()
  })

  it('rejects unsupported actions before opening the destination dialog', async () => {
    await expect(save('execute')).rejects.toThrow('Invalid post-download action')
    expect(showSaveDialog).not.toHaveBeenCalled()
    expect(showItemInFolder).not.toHaveBeenCalled()
  })
})
