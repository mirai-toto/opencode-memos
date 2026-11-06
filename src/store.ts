import { randomUUID } from "node:crypto"
import type { Dirent } from "node:fs"
import { mkdir, readdir, readFile, rename, rm, writeFile } from "node:fs/promises"
import { homedir } from "node:os"
import { join, resolve } from "node:path"
import { emptyMemoGroup, parseMemoGroup, serializeMemoGroup, type Memo, type MemoGroup } from "./model.ts"

export type IdFactory = () => string

export class MemoRepository {
  private readonly rootDirectory: string
  private readonly idFactory: IdFactory

  constructor(rootDirectory: string = join(homedir(), ".memos"), idFactory: IdFactory = randomUUID) {
    this.rootDirectory = resolve(rootDirectory)
    this.idFactory = idFactory
  }

  async listGroups(): Promise<string[]> {
    let entries: Dirent<string>[]
    try {
      entries = await readdir(this.rootDirectory, { withFileTypes: true, encoding: "utf8" })
    } catch (error: unknown) {
      if (errorCode(error) === "ENOENT") return ["personal"]
      throw error
    }

    const groups: string[] = entries
      .filter((entry) => entry.isDirectory() && isValidGroup(entry.name))
      .map((entry) => entry.name)
      .sort((left: string, right: string): number => left.localeCompare(right))
    return groups.length > 0 ? groups : ["personal"]
  }

  async read(group: string): Promise<MemoGroup> {
    const filePath: string = this.dataPath(group)
    try {
      const text: string = await readFile(filePath, "utf8")
      return parseMemoGroup(text, filePath)
    } catch (error: unknown) {
      if (errorCode(error) === "ENOENT") return emptyMemoGroup()
      throw error
    }
  }

  async add(group: string, content: string): Promise<Memo> {
    const current: MemoGroup = await this.read(group)
    const memo: Memo = { id: this.idFactory(), checked: false, deleted: false, content }
    await this.write(group, { version: 1, memos: [...current.memos, memo] })
    return memo
  }

  async updateContent(group: string, memoID: string, content: string): Promise<void> {
    await this.update(group, memoID, (memo: Memo): Memo => ({ ...memo, content }))
  }

  async setChecked(group: string, memoID: string, checked: boolean): Promise<void> {
    await this.update(group, memoID, (memo: Memo): Memo => ({ ...memo, checked }))
  }

  async setDeleted(group: string, memoID: string, deleted: boolean): Promise<void> {
    await this.update(group, memoID, (memo: Memo): Memo => ({ ...memo, deleted }))
  }

  private async update(group: string, memoID: string, change: (memo: Memo) => Memo): Promise<void> {
    const current: MemoGroup = await this.read(group)
    let found: boolean = false
    const memos: Memo[] = current.memos.map((memo: Memo): Memo => {
      if (memo.id !== memoID) return memo
      found = true
      return change(memo)
    })
    if (!found) throw new Error(`Memo ${memoID} was not found in group ${group}`)
    await this.write(group, { version: 1, memos })
  }

  private async write(group: string, data: MemoGroup): Promise<void> {
    const text: string = serializeMemoGroup(data)
    const directory: string = this.groupPath(group)
    await mkdir(directory, { recursive: true, mode: 0o700 })

    const destination: string = this.dataPath(group)
    const temporary: string = join(directory, `.memos-${randomUUID()}.tmp`)
    try {
      await writeFile(temporary, text, { encoding: "utf8", mode: 0o600, flag: "wx" })
      await rename(temporary, destination)
    } catch (error: unknown) {
      await rm(temporary, { force: true }).catch((): undefined => undefined)
      throw error
    }
  }

  private dataPath(group: string): string {
    return join(this.groupPath(group), "memos.json")
  }

  private groupPath(group: string): string {
    if (!isValidGroup(group)) throw new Error(`Invalid memo group name: ${group}`)
    return join(this.rootDirectory, group)
  }
}

function isValidGroup(group: string): boolean {
  return /^[a-zA-Z0-9][a-zA-Z0-9_-]*$/.test(group)
}

function errorCode(error: unknown): string | undefined {
  if (typeof error !== "object" || error === null || !("code" in error)) return undefined
  const code: unknown = error.code
  return typeof code === "string" ? code : undefined
}
