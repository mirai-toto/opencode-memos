import assert from "node:assert/strict"
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"
import { MemoRepository } from "../src/store.ts"
import type { Memo } from "../src/model.ts"

async function withTemporaryDirectory(run: (directory: string) => Promise<void>): Promise<void> {
  const directory: string = await mkdtemp(join(tmpdir(), "opencode-memos-test-"))
  try {
    await run(directory)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
}

test("stores arbitrary Markdown content and memo settings per group", async (): Promise<void> => {
  await withTemporaryDirectory(async (directory: string): Promise<void> => {
    const repository: MemoRepository = new MemoRepository(directory, (): string => "memo-1")
    const content: string = "# A heading\n\nUnstructured notes:\n- first\n- second"
    const created: Memo = await repository.add("personal", content)

    assert.deepEqual(created, { id: "memo-1", checked: false, deleted: false, content })
    await repository.setChecked("personal", created.id, true)
    await repository.setDeleted("personal", created.id, true)

    assert.deepEqual(await repository.read("personal"), {
      version: 1,
      memos: [{ ...created, checked: true, deleted: true }],
    })
    assert.deepEqual(await repository.read("work"), { version: 1, memos: [] })
    assert.deepEqual(await repository.listGroups(), ["personal"])
  })
})

test("does not alter a legacy memo.md when JSON data is absent", async (): Promise<void> => {
  await withTemporaryDirectory(async (directory: string): Promise<void> => {
    const personalDirectory: string = join(directory, "personal")
    await mkdir(personalDirectory)
    const legacyPath: string = join(personalDirectory, "memo.md")
    const legacyText: string = "# Existing notes\n\nArbitrary Markdown.\n"
    await writeFile(legacyPath, legacyText, "utf8")

    const repository: MemoRepository = new MemoRepository(directory)
    assert.deepEqual(await repository.listGroups(), ["personal"])
    assert.deepEqual(await repository.read("personal"), { version: 1, memos: [] })
    assert.equal(await readFile(legacyPath, "utf8"), legacyText)
  })
})

test("rejects invalid group names and malformed JSON rather than overwriting it", async (): Promise<void> => {
  await withTemporaryDirectory(async (directory: string): Promise<void> => {
    const repository: MemoRepository = new MemoRepository(directory)
    await assert.rejects(repository.add("../outside", "unsafe"), /Invalid memo group name/)

    const groupDirectory: string = join(directory, "personal")
    await mkdir(groupDirectory)
    const dataPath: string = join(groupDirectory, "memos.json")
    const malformed: string = "{not json"
    await writeFile(dataPath, malformed, "utf8")

    await assert.rejects(repository.read("personal"), /is not valid JSON/)
    assert.equal(await readFile(dataPath, "utf8"), malformed)
  })
})
