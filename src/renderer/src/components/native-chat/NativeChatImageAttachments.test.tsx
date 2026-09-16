// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { TooltipProvider } from '@/components/ui/tooltip'
import { resetLocalImageSrcStateForTests } from '@/components/editor/useLocalImageSrc'
import type { RuntimeFileOperationArgs } from '@/runtime/runtime-file-client'
import type { NativeChatBlock } from '../../../../shared/native-chat-types'
import { NativeChatImageAttachments } from './NativeChatImageAttachments'
import { NativeChatImageScopeContext } from './native-chat-image-scope'

const mocks = vi.hoisted(() => ({
  readFile: vi.fn(),
  authorizeExternalPath: vi.fn(),
  openFilePath: vi.fn(),
  downloadAndOpenRemoteTerminalFile: vi.fn(),
  settings: { terminalLinkActionPopoverEnabled: true },
  openSettingsPage: vi.fn(),
  openSettingsTarget: vi.fn()
}))
vi.mock('@/store', () => ({
  useAppStore: Object.assign((selector: (state: typeof mocks) => unknown) => selector(mocks), {
    getState: () => mocks
  })
}))
vi.mock('@/i18n/i18n', () => ({ translate: (_key: string, fallback: string) => fallback }))
vi.mock('@/components/terminal-pane/terminal-remote-file-download-open', () => ({
  downloadAndOpenRemoteTerminalFile: mocks.downloadAndOpenRemoteTerminalFile
}))

const local: RuntimeFileOperationArgs = {
  settings: { activeRuntimeEnvironmentId: null },
  worktreeId: 'folder:workspace',
  worktreePath: '/workspace',
  expectedExecutionHostId: 'local'
}
const imagePath = '/home/user/.codex/generated_images/session/generated.png'
const blocks: NativeChatBlock[] = [{ type: 'image-ref', path: imagePath }]

function ImageMessage({
  context = local,
  images = blocks
}: {
  context?: RuntimeFileOperationArgs | null
  images?: NativeChatBlock[]
}) {
  return (
    <TooltipProvider>
      <NativeChatImageAttachments blocks={images} runtimeContext={context} compact={false} />
    </TooltipProvider>
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  resetLocalImageSrcStateForTests()
  vi.stubGlobal('IntersectionObserver', undefined)
  vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:image')
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
  vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue('Macintosh')
  mocks.settings.terminalLinkActionPopoverEnabled = true
  mocks.readFile.mockResolvedValue({ content: 'AA==', isBinary: true, mimeType: 'image/png' })
  mocks.authorizeExternalPath.mockResolvedValue(undefined)
  mocks.openFilePath.mockResolvedValue(true)
  Object.defineProperty(window, 'api', {
    configurable: true,
    value: {
      fs: { readFile: mocks.readFile, authorizeExternalPath: mocks.authorizeExternalPath },
      shell: { openFilePath: mocks.openFilePath }
    }
  })
})
afterEach(() => {
  cleanup()
  resetLocalImageSrcStateForTests()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('transcript image destinations', () => {
  it.each([
    ['/home/user/Paris #1% sunny?.png', '/home/user/Paris #1% sunny?.png'],
    ['C:\\Images\\Paris #1.png', 'C:/Images/Paris #1.png']
  ])('preserves literal filename characters in %s', async (path, expectedPath) => {
    render(<ImageMessage images={[{ type: 'image-ref', path }]} />)
    await screen.findByRole('img')
    expect(mocks.readFile).toHaveBeenCalledWith({ filePath: expectedPath, connectionId: undefined })
  })

  it.each(['menu', 'preview'] as const)(
    'dismisses the %s when the chat is hidden or replaced',
    async (overlay) => {
      const message = (scope: string | null) => (
        <NativeChatImageScopeContext.Provider value={scope}>
          <ImageMessage />
        </NativeChatImageScopeContext.Provider>
      )
      const { rerender } = render(message('first'))
      await screen.findByRole('img')
      for (const scope of [null, 'second']) {
        fireEvent.click(screen.getByRole('button', { name: 'View image: generated.png' }))
        const previewAction = await screen.findByRole('button', { name: /Open in Orca preview/ })
        if (overlay === 'preview') {
          fireEvent.click(previewAction)
        }
        rerender(message(scope))
        expect(screen.queryByRole('button', { name: /Open in Orca preview/ })).toBeNull()
        expect(screen.queryByRole('dialog', { name: 'generated.png' })).toBeNull()
        rerender(message('first'))
        expect(screen.queryByRole('dialog', { name: 'generated.png' })).toBeNull()
      }
    }
  )

  it('shows an inline generated image without reading a local file', async () => {
    render(
      <ImageMessage
        context={null}
        images={[{ type: 'image-ref', url: 'data:image/png;base64,AA==', alt: 'Generated image' }]}
      />
    )
    const image = await screen.findByRole('img', { name: 'Generated image' })
    expect(image.getAttribute('src')).toBe('data:image/png;base64,AA==')
    expect(mocks.readFile).not.toHaveBeenCalled()
    expect(mocks.authorizeExternalPath).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'View image: Generated image' }))
    expect(
      await screen.findByRole('button', { name: /Download & open with default app/ })
    ).toBeTruthy()
  })

  it('shows an uncropped preview and offers both destinations without opening either', async () => {
    render(<ImageMessage />)
    const image = await screen.findByRole('img', { name: 'generated.png' })
    expect(image.classList.contains('object-contain')).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: 'View image: generated.png' }))
    expect(await screen.findByRole('button', { name: /Open in Orca preview/ })).toBeTruthy()
    expect(screen.getByRole('button', { name: /Open with default app/ })).toBeTruthy()
    expect(mocks.openFilePath).not.toHaveBeenCalled()
    expect(screen.queryByRole('dialog', { name: 'generated.png' })).toBeNull()
  })

  it('opens the full-size Orca preview after choosing it', async () => {
    render(<ImageMessage />)
    await screen.findByRole('img')
    fireEvent.click(screen.getByRole('button', { name: 'View image: generated.png' }))
    fireEvent.click(await screen.findByRole('button', { name: /Open in Orca preview/ }))
    expect(await screen.findByRole('dialog', { name: 'generated.png' })).toBeTruthy()
    expect(mocks.openFilePath).not.toHaveBeenCalled()
  })

  it('opens the selected local image with the default app', async () => {
    render(<ImageMessage />)
    await screen.findByRole('img')
    fireEvent.click(screen.getByRole('button', { name: 'View image: generated.png' }))
    fireEvent.click(await screen.findByRole('button', { name: /Open with default app/ }))
    await waitFor(() => expect(mocks.openFilePath).toHaveBeenCalledWith(imagePath))
  })

  it.each(['Macintosh', 'Linux'])(
    'honors direct preview and external-open shortcuts on %s',
    async (platform) => {
      vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue(platform)
      render(<ImageMessage />)
      await screen.findByRole('img')
      const modifier = platform === 'Macintosh' ? { metaKey: true } : { ctrlKey: true }
      const button = screen.getByRole('button', { name: 'View image: generated.png' })
      fireEvent.click(button, { ...modifier, shiftKey: true })
      await waitFor(() => expect(mocks.openFilePath).toHaveBeenCalledWith(imagePath))
      fireEvent.click(button, modifier)
      expect(await screen.findByRole('dialog', { name: 'generated.png' })).toBeTruthy()
    }
  )

  it('opens the preview directly when destination menus are disabled', async () => {
    mocks.settings.terminalLinkActionPopoverEnabled = false
    render(<ImageMessage />)
    await screen.findByRole('img')
    fireEvent.click(screen.getByRole('button', { name: 'View image: generated.png' }))
    expect(await screen.findByRole('dialog', { name: 'generated.png' })).toBeTruthy()
  })

  it('reads an SSH image from its owner and downloads before opening locally', async () => {
    const context: RuntimeFileOperationArgs = {
      ...local,
      expectedExecutionHostId: 'ssh:host',
      connectionId: 'host',
      expectedExternalSshTargetId: 'host'
    }
    render(<ImageMessage context={context} />)
    await screen.findByRole('img')
    expect(mocks.readFile).toHaveBeenCalledWith({ filePath: imagePath, connectionId: 'host' })
    expect(mocks.authorizeExternalPath).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'View image: generated.png' }))
    fireEvent.click(await screen.findByRole('button', { name: /Download & open with default app/ }))
    expect(mocks.downloadAndOpenRemoteTerminalFile).toHaveBeenCalledWith(context, imagePath)
    expect(mocks.openFilePath).not.toHaveBeenCalled()
  })

  it('resolves relative image paths against the owning workspace', async () => {
    render(<ImageMessage images={[{ type: 'image-ref', path: 'outputs/generated.png' }]} />)
    await screen.findByRole('img')
    expect(mocks.readFile).toHaveBeenCalledWith({
      filePath: '/workspace/outputs/generated.png',
      connectionId: undefined
    })
  })

  it('keeps a missing image clickable and reports an unavailable preview', async () => {
    mocks.readFile.mockRejectedValue(new Error('File not found'))
    render(<ImageMessage />)
    fireEvent.click(screen.getByRole('button', { name: 'View image: generated.png' }))
    fireEvent.click(await screen.findByRole('button', { name: /Open in Orca preview/ }))
    expect(await screen.findByText('Preview unavailable')).toBeTruthy()
    expect(screen.queryByRole('img')).toBeNull()
  })

  it('does not read an unresolved host or fall back to the local filesystem', () => {
    render(<ImageMessage context={null} />)
    expect(
      screen.getByRole('button', { name: 'View image: generated.png' }).hasAttribute('disabled')
    ).toBe(true)
    expect(mocks.readFile).not.toHaveBeenCalled()
    expect(mocks.authorizeExternalPath).not.toHaveBeenCalled()
  })
})
