// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { openChatImageWithDefaultApp } from './native-chat-image-open'

const mocks = vi.hoisted(() => ({ toastError: vi.fn(), download: vi.fn() }))
vi.mock('sonner', () => ({ toast: { error: mocks.toastError } }))
vi.mock('@/i18n/i18n', () => ({ translate: (_key: string, fallback: string) => fallback }))
vi.mock('@/components/terminal-pane/terminal-remote-file-download-open', () => ({
  downloadAndOpenRemoteTerminalFile: mocks.download
}))
const openFilePath = vi.fn()
const saveDownloadedFile = vi.fn()
const authorizeExternalPath = vi.fn()
const fetchImage = vi.fn()
const context = {
  settings: { activeRuntimeEnvironmentId: null },
  expectedExecutionHostId: 'local' as const,
  worktreeId: 'wt-1',
  worktreePath: '/workspace'
}

beforeEach(() => {
  vi.clearAllMocks()
  openFilePath.mockResolvedValue(true)
  saveDownloadedFile.mockResolvedValue({ canceled: false, destinationPath: '/downloads/image.png' })
  authorizeExternalPath.mockResolvedValue(undefined)
  fetchImage.mockImplementation(
    async () => new Response(new Uint8Array([0]), { headers: { 'Content-Type': 'image/png' } })
  )
  vi.stubGlobal('fetch', fetchImage)
  Object.defineProperty(window, 'api', {
    configurable: true,
    value: {
      fs: { saveDownloadedFile, authorizeExternalPath },
      shell: { openFilePath }
    }
  })
})
afterEach(() => vi.unstubAllGlobals())

describe('opening generated images externally', () => {
  it('materializes an inline image before asking the OS to open it', async () => {
    await openChatImageWithDefaultApp({
      filePath: null,
      source: 'data:image/png;base64,AA==',
      name: 'Generated image',
      context: null
    })
    expect(saveDownloadedFile).toHaveBeenCalledWith({
      suggestedName: 'Generated image.png',
      content: 'AA==',
      encoding: 'base64'
    })
    expect(openFilePath).toHaveBeenCalledWith('/downloads/image.png')
    expect(authorizeExternalPath).not.toHaveBeenCalled()
  })

  it('treats cancelling the save dialog as a no-op', async () => {
    saveDownloadedFile.mockResolvedValue({ canceled: true })
    await openChatImageWithDefaultApp({
      filePath: null,
      source: 'data:image/png;base64,AA==',
      name: 'image.png',
      context: null
    })
    expect(openFilePath).not.toHaveBeenCalled()
    expect(mocks.toastError).not.toHaveBeenCalled()
  })

  it('reports an OS-open failure visibly', async () => {
    openFilePath.mockResolvedValue(false)
    await openChatImageWithDefaultApp({
      filePath: '/generated/image.png',
      source: undefined,
      name: 'image.png',
      context
    })
    expect(mocks.toastError).toHaveBeenCalledOnce()
  })

  it('does not launch an unresolved remote path on the client machine', async () => {
    await openChatImageWithDefaultApp({
      filePath: '/generated/image.png',
      source: undefined,
      name: 'image.png',
      context: { ...context, expectedExecutionHostId: 'ssh:disconnected' }
    })
    expect(mocks.download).not.toHaveBeenCalled()
    expect(authorizeExternalPath).not.toHaveBeenCalled()
    expect(openFilePath).not.toHaveBeenCalled()
    expect(mocks.toastError).toHaveBeenCalledOnce()
  })
})
