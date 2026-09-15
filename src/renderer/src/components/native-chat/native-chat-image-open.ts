import { toast } from 'sonner'
import { translate } from '@/i18n/i18n'
import {
  getRuntimeFileReadScope,
  type RuntimeFileOperationArgs
} from '@/runtime/runtime-file-client'
import { downloadAndOpenRemoteTerminalFile } from '@/components/terminal-pane/terminal-remote-file-download-open'
import { IMAGE_FILE_MIME_TYPES } from '../../../../shared/image-file-extensions'
import { isClientLocalChatImage } from './native-chat-image-destination'

async function saveInlineImage(source: string, name: string) {
  const response = await fetch(source)
  if (!response.ok) {
    throw new Error('Image download failed')
  }
  const blob = await response.blob()
  const content = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(new Error('Image download failed'))
    reader.onload = () => {
      const data = typeof reader.result === 'string' ? reader.result : ''
      const separator = data.indexOf(',')
      if (separator === -1 || !data.startsWith('data:image/')) {
        reject(new Error('Image download failed'))
        return
      }
      resolve(data.slice(separator + 1))
    }
    reader.readAsDataURL(blob)
  })
  const extension = Object.entries(IMAGE_FILE_MIME_TYPES).find(
    ([, mime]) => mime === blob.type
  )?.[0]
  if (!extension) {
    throw new Error('Unsupported image format')
  }
  const hasImageExtension = Object.keys(IMAGE_FILE_MIME_TYPES).some((ext) =>
    name.toLowerCase().endsWith(ext)
  )
  return window.api.fs.saveDownloadedFile({
    suggestedName: hasImageExtension ? name : `${name}${extension}`,
    content,
    encoding: 'base64'
  })
}

export async function openChatImageWithDefaultApp({
  filePath,
  source,
  name,
  context
}: {
  filePath: string | null
  source: string | undefined
  name: string
  context: RuntimeFileOperationArgs | null | undefined
}): Promise<void> {
  try {
    let destinationPath: string
    if (filePath) {
      if (!context) {
        throw new Error('Image owner is unavailable')
      }
      if (!isClientLocalChatImage(context)) {
        if (!getRuntimeFileReadScope(context.settings, context.connectionId)) {
          throw new Error('Image owner is unavailable')
        }
        await downloadAndOpenRemoteTerminalFile(context, filePath)
        return
      }
      await window.api.fs.authorizeExternalPath({ targetPath: filePath })
      destinationPath = filePath
    } else {
      if (!source) {
        throw new Error('Image preview is unavailable')
      }
      const result = await saveInlineImage(source, name)
      if (result.canceled) {
        return
      }
      destinationPath = result.destinationPath
    }
    if (!(await window.api.shell.openFilePath(destinationPath))) {
      throw new Error('The default app could not open this image')
    }
  } catch {
    toast.error(
      translate(
        'components.native-chat.image.openFailed',
        'Could not open the image. The file may no longer be available.'
      )
    )
  }
}
