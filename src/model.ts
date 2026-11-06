export interface Memo {
  id: string
  title: string
  checked: boolean
  deleted: boolean
  content: string
}

export interface MemoGroup {
  version: 2
  memos: Memo[]
}

export function emptyMemoGroup(): MemoGroup {
  return { version: 2, memos: [] }
}

export function parseMemoGroup(text: string, source: string): MemoGroup {
  let value: unknown
  try {
    value = JSON.parse(text) as unknown
  } catch (error: unknown) {
    throw new Error(`${source} is not valid JSON`, { cause: error })
  }

  if (!isRecord(value)) throw new Error(`${source} must contain a JSON object`)
  if (value.version !== 2) throw new Error(`${source} has unsupported version ${String(value.version)}`)
  if (!Array.isArray(value.memos)) throw new Error(`${source} must contain a memos array`)

  const seen: Set<string> = new Set<string>()
  const memos: Memo[] = value.memos.map((entry: unknown, index: number): Memo => {
    if (!isRecord(entry)) throw new Error(`${source} memo ${index + 1} must be an object`)
    if (typeof entry.id !== "string" || entry.id.length === 0) {
      throw new Error(`${source} memo ${index + 1} must have a non-empty id`)
    }
    if (seen.has(entry.id)) throw new Error(`${source} contains duplicate memo id ${entry.id}`)
    if (typeof entry.title !== "string" || entry.title.trim().length === 0) {
      throw new Error(`${source} memo ${entry.id} must have a non-empty title`)
    }
    if (typeof entry.checked !== "boolean") throw new Error(`${source} memo ${entry.id} must have a boolean checked field`)
    if (typeof entry.deleted !== "boolean") throw new Error(`${source} memo ${entry.id} must have a boolean deleted field`)
    if (typeof entry.content !== "string") throw new Error(`${source} memo ${entry.id} must have string content`)
    seen.add(entry.id)
    return { id: entry.id, title: entry.title, checked: entry.checked, deleted: entry.deleted, content: entry.content }
  })

  return { version: 2, memos }
}

export function serializeMemoGroup(group: MemoGroup): string {
  if (group.version !== 2) throw new Error(`Unsupported memo group version ${String(group.version)}`)
  const seen: Set<string> = new Set<string>()
  for (const memo of group.memos) {
    if (typeof memo.id !== "string" || memo.id.length === 0) throw new Error("Memo id must not be empty")
    if (seen.has(memo.id)) throw new Error(`Duplicate memo id ${memo.id}`)
    if (typeof memo.title !== "string" || memo.title.trim().length === 0) {
      throw new Error(`Memo ${memo.id} must have a non-empty title`)
    }
    if (typeof memo.checked !== "boolean" || typeof memo.deleted !== "boolean" || typeof memo.content !== "string") {
      throw new Error(`Memo ${memo.id} has invalid fields`)
    }
    seen.add(memo.id)
  }
  return `${JSON.stringify(group, null, 2)}\n`
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}
