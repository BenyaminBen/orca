import { stripAnsiEscapeSequences } from './ansi-escape-sequences'
import { typeAgentTuiCommand } from './agent-tui-command-typing'
import {
  CODEX_PERMISSION_MODES,
  isCodexPermissionMode,
  type CodexPermissionLabel,
  type CodexPermissionMode,
  type CodexPermissionOptions
} from './codex-permissions'

function screenText(screen: string): string {
  return stripAnsiEscapeSequences(screen).replace(/\r\n?/g, '\n')
}

export function readCodexPermissionScreen(screen: string): {
  current?: CodexPermissionLabel
  menu?: CodexPermissionOptions
  rows: { mode: CodexPermissionMode; key: string }[]
  confirmation: boolean
  emptyComposer: boolean
  composerText?: string
} {
  const text = screenText(screen)
  const menuStart = text.lastIndexOf('Update Model Permissions')
  const menuText = menuStart !== -1 ? text.slice(menuStart) : ''
  const rows = CODEX_PERMISSION_MODES.flatMap((mode) => {
    const match = menuText.match(
      new RegExp(`(?:^|\\s)([1-9])\\. ${mode.label}(?: \\(current\\))?(?:\\s|$)`)
    )
    return match ? [{ mode: mode.value, key: match[1]! }] : []
  })
  let current: CodexPermissionLabel | undefined
  let lastIndex = -1
  for (const mode of CODEX_PERMISSION_MODES) {
    const echo = text.lastIndexOf(`Permissions updated to ${mode.label}`)
    if (echo > lastIndex) {
      lastIndex = echo
      current = mode.value
    }
  }
  const status = [...text.matchAll(/Permissions:\s+([^\n│]+)/g)].at(-1)
  if (status && (status.index ?? -1) > lastIndex) {
    const label = status[1]!.trim()
    current =
      label === 'Full Access'
        ? 'full-access'
        : label === 'Workspace (Ask for approval)'
          ? 'ask-for-approval'
          : label === 'Workspace (Approve for me)'
            ? 'approve-for-me'
            : /^Read.only\b/i.test(label)
              ? 'read-only'
              : 'custom'
  }
  const menu =
    menuText.includes('Press enter to confirm or esc to go back') && rows.length > 0
      ? {
          current: CODEX_PERMISSION_MODES.find((mode) =>
            menuText.includes(`${mode.label} (current)`)
          )?.value,
          choices: CODEX_PERMISSION_MODES.map(({ value }) => ({
            value,
            ...(rows.some((row) => row.mode === value)
              ? {}
              : { disabledReason: 'This CLI version does not offer this mode.' })
          }))
        }
      : undefined
  if (menu) {
    current = menu.current
  }
  const confirmation =
    /Enable full access\?/.test(text) &&
    /1\. Yes, continue anyway\s+Apply full access for this session/.test(text) &&
    /2\. Cancel/.test(text)
  const prompt = [...text.matchAll(/^\s*› (.*)$/gm)].at(-1)?.[1]?.trim()
  return {
    current,
    menu,
    rows,
    confirmation,
    composerText: prompt,
    emptyComposer:
      !menu &&
      !confirmation &&
      !!prompt &&
      (prompt === 'Ask Codex to do anything' ||
        prompt === 'Ask a follow-up question' ||
        /^Try ["“]/.test(prompt))
  }
}

type PermissionTerminal = {
  readScreen: () => Promise<string | null> | string | null
  write: (key: string) => Promise<boolean>
  mode?: CodexPermissionMode
  signal?: AbortSignal
  timeoutMs?: number
}

function permissionScreenReader(input: PermissionTerminal) {
  return async () => {
    if (input.signal?.aborted) {
      throw new Error('Permission change was canceled.')
    }
    const screen = await input.readScreen()
    if (screen === null) {
      throw new Error('The terminal screen is unavailable.')
    }
    return readCodexPermissionScreen(screen)
  }
}

async function waitForPermissionScreen(
  read: ReturnType<typeof permissionScreenReader>,
  accept: (state: ReturnType<typeof readCodexPermissionScreen>) => boolean,
  deadline: number
) {
  while (Date.now() < deadline) {
    const state = await read()
    if (accept(state)) {
      return state
    }
    await new Promise((resolve) => setTimeout(resolve, 60))
  }
  throw new Error('The CLI did not confirm the permission change. Check its terminal.')
}

export async function runCodexPermissionMenu(
  input: PermissionTerminal
): Promise<CodexPermissionOptions> {
  const deadline = Date.now() + (input.timeoutMs ?? 8_000)
  const read = permissionScreenReader(input)
  const write = async (key: string): Promise<void> => {
    if (input.signal?.aborted) {
      throw new Error('Permission change was canceled.')
    }
    if (!(await input.write(key))) {
      throw new Error('The terminal did not accept the permission command.')
    }
  }
  const wait = (accept: (state: ReturnType<typeof readCodexPermissionScreen>) => boolean) =>
    waitForPermissionScreen(read, accept, deadline)
  let ownsMenu = false
  try {
    const before = await read()
    if (!before.emptyComposer && !before.menu) {
      throw new Error('Finish or clear the terminal input before changing permissions.')
    }
    if (!before.menu) {
      const outcome = await typeAgentTuiCommand({
        command: '/permissions',
        signal: input.signal,
        write: async (key) => {
          if (key === '\r') {
            // A rendered command proves the CLI has drained its paste buffer before Enter.
            await wait((state) => state.composerText === '/permissions')
          }
          await write(key)
          return 'accepted'
        }
      })
      if (outcome !== 'accepted') {
        throw new Error('The permission command was canceled.')
      }
    }
    ownsMenu = true
    const state = await wait((state) => !!state.menu)
    const menu = state.menu!
    if (!input.mode || input.mode === menu.current) {
      await write('\u001b')
      await wait((state) => state.emptyComposer)
      ownsMenu = false
      return menu
    }
    const row = state.rows.find((row) => row.mode === input.mode)
    if (!row) {
      throw new Error('This CLI version does not offer this permission mode.')
    }
    await write(row.key)
    let confirmedFullAccess = false
    const applied = await wait((next) => {
      return (next.emptyComposer && next.current === input.mode) || next.confirmation
    })
    if (applied.confirmation) {
      if (input.mode !== 'full-access') {
        throw new Error('The CLI opened an unexpected confirmation.')
      }
      // The selector has already obtained consent for this exact Full Access change.
      await write('\r')
      confirmedFullAccess = true
    }
    if (confirmedFullAccess) {
      await wait((next) => next.emptyComposer && next.current === input.mode)
    }
    ownsMenu = false
    return { ...menu, current: input.mode }
  } finally {
    if (ownsMenu) {
      const screen = await Promise.resolve(input.readScreen()).catch(() => null)
      const state = screen ? readCodexPermissionScreen(screen) : null
      if (state?.menu || state?.confirmation) {
        await input.write('\u001b').catch(() => false)
      }
    }
  }
}

export async function clearCodexConversationKeepingPermissions(
  input: PermissionTerminal
): Promise<CodexPermissionOptions> {
  const before = await runCodexPermissionMenu(input)
  if (!isCodexPermissionMode(before.current)) {
    throw new Error('Select a supported permission mode before clearing this conversation.')
  }
  const read = permissionScreenReader(input)
  const deadline = Date.now() + (input.timeoutMs ?? 8_000)
  const outcome = await typeAgentTuiCommand({
    command: '/clear',
    signal: input.signal,
    write: async (key) => {
      if (key === '\r') {
        await waitForPermissionScreen(read, (state) => state.composerText === '/clear', deadline)
      }
      return (await input.write(key)) ? 'accepted' : 'rejected'
    }
  })
  if (outcome !== 'accepted') {
    throw new Error('The clear command was not accepted.')
  }
  await waitForPermissionScreen(read, (state) => state.emptyComposer, deadline)
  // Clearing creates a new CLI thread, whose startup defaults can differ from this chat.
  return runCodexPermissionMenu({ ...input, mode: before.current })
}
