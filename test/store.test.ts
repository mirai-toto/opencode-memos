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
    const created: Memo = await repository.add("personal", "A heading", content)

    assert.deepEqual(created, { id: "memo-1", title: "A heading", checked: false, deleted: false, content })
    await repository.setChecked("personal", created.id, true)
    await repository.setDeleted("personal", created.id, true)
    await repository.updateTitle("personal", created.id, "Renamed heading")
    await repository.updateContent("personal", created.id, "Updated body")
    await repository.updateMemo("personal", created.id, "Final title", "First line\nSecond line")

    assert.deepEqual(await repository.read("personal"), {
      version: 2,
      memos: [{ ...created, title: "Final title", checked: true, deleted: true, content: "First line\nSecond line" }],
    })
    assert.deepEqual(await repository.read("work"), { version: 2, memos: [] })
    await repository.add("ideas", "Example group memo", "A memo in another group.")
    assert.deepEqual(await repository.listGroups(), ["ideas", "personal"])
  })
})

test("deleteMemo permanently removes a memo", async (): Promise<void> => {
  await withTemporaryDirectory(async (directory: string): Promise<void> => {
    const repository: MemoRepository = new MemoRepository(directory, (): string => "memo-1")
    await repository.add("personal", "Temp", "body")
    await repository.deleteMemo("personal", "memo-1")
    assert.deepEqual(await repository.read("personal"), { version: 2, memos: [] })
    await assert.rejects(repository.deleteMemo("personal", "memo-1"), /was not found/)
  })
})

test("starts with no groups and creates distinct empty groups", async (): Promise<void> => {
  await withTemporaryDirectory(async (directory: string): Promise<void> => {
    const root: string = join(directory, "memos")
    const repository: MemoRepository = new MemoRepository(root)
    assert.deepEqual(await repository.listGroups(), [])

    await repository.createGroup("personal")
    await repository.createGroup("work")
    await repository.createGroup("ideas_2026")
    assert.deepEqual(await repository.listGroups(), ["ideas_2026", "personal", "work"])
    assert.deepEqual(await repository.read("ideas_2026"), { version: 2, memos: [] })
    await assert.rejects(repository.createGroup("personal"), { code: "EEXIST" })
    await assert.rejects(repository.createGroup("../outside"), /Invalid memo group name/)
  })
})

test("deletes only empty groups without touching other files", async (): Promise<void> => {
  await withTemporaryDirectory(async (directory: string): Promise<void> => {
    const repository: MemoRepository = new MemoRepository(directory, (): string => "memo-1")
    await repository.createGroup("empty")
    await repository.createGroup("hidden")
    await repository.createGroup("legacy")
    await repository.add("hidden", "Hidden", "body")
    await repository.setDeleted("hidden", "memo-1", true)
    const legacyPath: string = join(directory, "legacy", "memo.md")
    await writeFile(legacyPath, "Keep me", "utf8")

    await assert.rejects(repository.deleteGroup("hidden"), /still contains memos/)
    await assert.rejects(repository.deleteGroup("legacy"), /contains other files/)
    assert.equal(await readFile(legacyPath, "utf8"), "Keep me")
    assert.deepEqual(await repository.read("hidden"), {
      version: 2,
      memos: [{ id: "memo-1", title: "Hidden", checked: false, deleted: true, content: "body" }],
    })

    await repository.deleteGroup("empty")
    assert.deepEqual(await repository.listGroups(), ["hidden", "legacy"])
    await assert.rejects(repository.deleteGroup("empty"), { code: "ENOENT" })
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
    assert.deepEqual(await repository.read("personal"), { version: 2, memos: [] })
    assert.equal(await readFile(legacyPath, "utf8"), legacyText)
  })
})

test("rejects invalid group names and malformed JSON rather than overwriting it", async (): Promise<void> => {
  await withTemporaryDirectory(async (directory: string): Promise<void> => {
    const repository: MemoRepository = new MemoRepository(directory)
    await assert.rejects(repository.add("../outside", "Title", "unsafe"), /Invalid memo group name/)

    const groupDirectory: string = join(directory, "personal")
    await mkdir(groupDirectory)
    const dataPath: string = join(groupDirectory, "memos.json")
    const malformed: string = "{not json"
    await writeFile(dataPath, malformed, "utf8")

    await assert.rejects(repository.read("personal"), /is not valid JSON/)
    assert.equal(await readFile(dataPath, "utf8"), malformed)
  })
})
