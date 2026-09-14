// Unanchored so caller-owned context around an Electron wrapper survives.
const IPC_INVOKE_PREFIX = /Error invoking remote method '[^']*':\s*(?:Error:\s*)?/
const IPC_HANDLER_PREFIX = /Error occurred in handler for '[^']*':\s*(?:Error:\s*)?/
// Why (#19334): once the wrapper is gone, a typed main-process error still leads with its class
// name — "WorktreeArchiveHookFailedError: Archive hook failed for worktree: …". That is noise to
// someone reading a toast, and it pushes the sentence that matters off the first line.
const ERROR_CLASS_PREFIX = /^(?:[A-Za-z_$][\w$]*)?Error:\s*/

export function readIpcErrorDetail(error: unknown): string | undefined {
  if (!(error instanceof Error)) {
    return undefined
  }
  const wrapped = IPC_INVOKE_PREFIX.test(error.message) || IPC_HANDLER_PREFIX.test(error.message)
  const unwrapped = error.message
    .replace(IPC_INVOKE_PREFIX, '')
    .replace(IPC_HANDLER_PREFIX, '')
    .trim()
  // Only strip the class name off something we actually unwrapped, so a renderer-local
  // `TypeError: …` keeps the prefix that tells you what it was.
  const message = wrapped ? unwrapped.replace(ERROR_CLASS_PREFIX, '').trim() : unwrapped
  return message || undefined
}

export function readIpcErrorMessage(error: unknown): string | undefined {
  return readIpcErrorDetail(error)?.split('\n')[0]?.trim() || undefined
}

// Preserve the legacy contract: wrapped errors are compact, while plain errors retain detail.
export function extractIpcErrorMessage(err: unknown, fallback: string): string {
  const detail = readIpcErrorDetail(err)
  if (!detail) {
    return fallback
  }
  const wrapped =
    err instanceof Error &&
    (IPC_INVOKE_PREFIX.test(err.message) || IPC_HANDLER_PREFIX.test(err.message))
  return wrapped ? detail.split('\n')[0]?.trim() || fallback : detail
}
