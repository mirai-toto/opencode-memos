import { spawn } from "node:child_process"
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { Plugin } from "@opencode/plugin/tui"

export type ExternalEditResult =
  | { readonly status: "saved"; readonly content: string }
  | { readonly status: "cancelled" }
  | { readonly status: "failed"; readonly message: string }

/** Resolves the user's preferred editor from $VISUAL then $EDITOR. */
export function editorCommand(): string | undefined {
  for (const name of ["VISUAL", "EDITOR"] as const) {
    const value: string = (process.env[name] ?? "").trim()
    if (value.length > 0) return value
  }
  return undefined
}

/**
 * Maps an editor process outcome to a result. `null` means the editor binary
 * could not be spawned; exit code 127 means the shell could not find the
 * command; any other non-zero exit is treated as the user cancelling the edit.
 */
export function interpretExit(command: string, exitCode: number | null, content: string): ExternalEditResult {
  if (exitCode === null) return { status: "failed", message: `Could not launch editor "${command}"` }
  if (exitCode === 127) return { status: "failed", message: `Editor command not found: ${command}` }
  if (exitCode !== 0) return { status: "cancelled" }
  return { status: "saved", content }
}

/**
 * Edits content in the user's external editor. The terminal is handed over to
 * the editor process (the renderer is suspended), then restored when it exits.
 */
export async function editInEditor(
  context: Plugin.Context,
  command: string,
  initialContent: string,
): Promise<ExternalEditResult> {
  const directory: string = await mkdtemp(join(tmpdir(), "opencode-memos-"))
  const filePath: string = join(directory, "content.md")
  try {
    await writeFile(filePath, initialContent, { encoding: "utf8", mode: 0o600 })
    await context.renderer.suspend()
    let exitCode: number | null
    try {
      exitCode = await spawnEditor(command, filePath)
    } finally {
      await context.renderer.resume()
    }
    const content: string = exitCode === 0 ? await readFile(filePath, "utf8") : initialContent
    return interpretExit(command, exitCode, content)
  } finally {
    await rm(directory, { recursive: true, force: true }).catch((): undefined => undefined)
  }
}

function spawnEditor(command: string, filePath: string): Promise<number | null> {
  return new Promise((resolve: (exitCode: number | null) => void): void => {
    const child = spawn("sh", ["-c", `${command} "$1"`, "opencode-memos", filePath], { stdio: "inherit" })
    child.once("error", (): void => resolve(null))
    child.once("close", (code: number | null): void => resolve(code ?? 0))
  })
}
