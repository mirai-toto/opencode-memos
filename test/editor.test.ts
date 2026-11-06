import assert from "node:assert/strict"
import test from "node:test"
import type { Plugin } from "@opencode/plugin/tui"
import { editorCommand, editInEditor, interpretExit } from "../src/editor.ts"

test("editorCommand prefers $VISUAL then $EDITOR and ignores blank values", (): void => {
  const original: { visual?: string; editor?: string } = {
    visual: process.env.VISUAL,
    editor: process.env.EDITOR,
  }
  try {
    delete process.env.VISUAL
    delete process.env.EDITOR
    assert.equal(editorCommand(), undefined)

    process.env.EDITOR = "vim"
    assert.equal(editorCommand(), "vim")

    process.env.VISUAL = "nvim"
    assert.equal(editorCommand(), "nvim")

    process.env.VISUAL = "   "
    process.env.EDITOR = "  code --wait  "
    assert.equal(editorCommand(), "code --wait")
  } finally {
    if (original.visual === undefined) delete process.env.VISUAL
    else process.env.VISUAL = original.visual
    if (original.editor === undefined) delete process.env.EDITOR
    else process.env.EDITOR = original.editor
  }
})

test("interpretExit maps editor outcomes to results", (): void => {
  assert.deepEqual(interpretExit("vim", 0, "body"), { status: "saved", content: "body" })
  assert.deepEqual(interpretExit("vim", null, "body"), {
    status: "failed",
    message: 'Could not launch editor "vim"',
  })
  assert.deepEqual(interpretExit("vim", 127, "body"), {
    status: "failed",
    message: "Editor command not found: vim",
  })
  assert.deepEqual(interpretExit("vim", 1, "body"), { status: "cancelled" })
})

function mockContext(): Plugin.Context {
  return {
    renderer: {
      suspend: async (): Promise<void> => undefined,
      resume: async (): Promise<void> => undefined,
    },
  } as unknown as Plugin.Context
}

test("editInEditor writes a temp file, runs the editor, and reads it back", async (): Promise<void> => {
  const result = await editInEditor(mockContext(), "printf edited-body >", "initial")
  assert.deepEqual(result, { status: "saved", content: "edited-body" })
})

test("editInEditor treats a non-zero editor exit as cancelled", async (): Promise<void> => {
  const result = await editInEditor(mockContext(), "false", "initial")
  assert.deepEqual(result, { status: "cancelled" })
})
