// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { RuntimeFileOperationArgs } from '@/runtime/runtime-file-client'
import type * as RuntimeRpcClient from '@/runtime/runtime-rpc-client'
import { readLocalImagePreview } from './local-image-src-reader'

const mocks = vi.hoisted(() => ({ callRuntimeRpc: vi.fn() }))
vi.mock('@/runtime/runtime-rpc-client', async (importOriginal) => ({
  ...(await importOriginal<typeof RuntimeRpcClient>()),
  callRuntimeRpc: mocks.callRuntimeRpc
}))
const context: RuntimeFileOperationArgs = {
  settings: { activeRuntimeEnvironmentId: null },
  worktreeId: 'wt-1',
  worktreePath: '/workspace',
  expectedExecutionHostId: 'local'
}
const filePath = '/home/user/generated/image.png'
const binary = { content: 'AA==', isBinary: true, mimeType: 'image/png' }
const readFile = vi.fn()
const authorizeExternalPath = vi.fn()

beforeEach(() => {
  vi.clearAllMocks()
  readFile.mockResolvedValue(binary)
  authorizeExternalPath.mockResolvedValue(undefined)
  mocks.callRuntimeRpc.mockResolvedValue(binary)
  Object.defineProperty(window, 'api', {
    configurable: true,
    value: { fs: { readFile, authorizeExternalPath } }
  })
})

describe('image preview file ownership', () => {
  it('grants the exact local image before reading it', async () => {
    await expect(readLocalImagePreview(filePath, undefined, context)).resolves.toEqual(binary)
    expect(authorizeExternalPath).toHaveBeenCalledWith({ targetPath: filePath })
    expect(authorizeExternalPath.mock.invocationCallOrder[0]).toBeLessThan(
      readFile.mock.invocationCallOrder[0]!
    )
  })

  it('does not read after local authorization fails', async () => {
    authorizeExternalPath.mockRejectedValue(new Error('Authorization failed'))
    await expect(readLocalImagePreview(filePath, undefined, context)).rejects.toThrow(
      'Authorization failed'
    )
    expect(readFile).not.toHaveBeenCalled()
  })

  it('does not add a grant without proven local ownership', async () => {
    await readLocalImagePreview(filePath)
    expect(authorizeExternalPath).not.toHaveBeenCalled()
  })

  it('reads a paired image through its runtime instead of the client filesystem', async () => {
    const remote = { ...context, settings: { activeRuntimeEnvironmentId: 'server' } }
    await expect(readLocalImagePreview('/workspace/image.png', undefined, remote)).resolves.toEqual(
      binary
    )
    expect(mocks.callRuntimeRpc).toHaveBeenCalledWith(
      expect.objectContaining({ environmentId: 'server' }),
      'files.readPreview',
      { worktree: 'id:wt-1', relativePath: 'image.png' },
      { timeoutMs: 15_000 }
    )
    expect(readFile).not.toHaveBeenCalled()
    expect(authorizeExternalPath).not.toHaveBeenCalled()
  })

  it('never falls back locally for an out-of-workspace paired image', async () => {
    const remote = { ...context, settings: { activeRuntimeEnvironmentId: 'server' } }
    await expect(readLocalImagePreview(filePath, undefined, remote)).rejects.toThrow(
      'outside the owning runtime worktree'
    )
    expect(readFile).not.toHaveBeenCalled()
    expect(authorizeExternalPath).not.toHaveBeenCalled()
  })
})
