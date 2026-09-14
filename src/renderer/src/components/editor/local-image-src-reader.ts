import type { RuntimeFileOperationArgs } from '@/runtime/runtime-file-client'
import { getRuntimeFileReadScope, readRuntimeFilePreview } from '@/runtime/runtime-file-client'

export async function readLocalImagePreview(
  absolutePath: string,
  connectionId?: string | null,
  runtimeContext?: Omit<RuntimeFileOperationArgs, 'connectionId'> & { connectionId?: string | null }
) {
  const ownerConnectionId = runtimeContext?.connectionId ?? connectionId ?? undefined
  if (!runtimeContext) {
    return window.api.fs.readFile({ filePath: absolutePath, connectionId: ownerConnectionId })
  }
  if (
    runtimeContext.expectedExecutionHostId === 'local' &&
    !getRuntimeFileReadScope(runtimeContext.settings, ownerConnectionId)
  ) {
    // Generated images can live outside the workspace; grant only the referenced local file.
    await window.api.fs.authorizeExternalPath({ targetPath: absolutePath })
  }
  return readRuntimeFilePreview(
    { ...runtimeContext, connectionId: ownerConnectionId },
    absolutePath
  )
}
