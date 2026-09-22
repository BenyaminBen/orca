import { shell } from 'electron'

export function validatePostDownloadAction(value: unknown): 'reveal' | undefined {
  if (value !== undefined && value !== 'reveal') {
    throw new Error('Invalid post-download action')
  }
  return value
}

export function completeDownload(destinationPath: string, action: 'reveal' | undefined) {
  // The download handler owns this local destination, even while a remote runtime is active.
  if (action === 'reveal') {
    shell.showItemInFolder(destinationPath)
  }
  return { canceled: false as const, destinationPath }
}
