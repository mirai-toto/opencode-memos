/** @jsxImportSource @opentui/solid */
import { Plugin } from "@opencode/plugin/tui"
import type { MouseEvent, ScrollBoxRenderable } from "@opentui/core"
import type { JSX } from "@opentui/solid"
import { createEffect, createSignal, For, onCleanup, onMount, Show, type Accessor, type Setter } from "solid-js"
import type { Store } from "solid-js/store"
import { MemoRepository } from "./store.ts"
import type { Memo } from "./model.ts"

interface PanelPreferences {
  collapsed: boolean
  group: string
  showDeleted: boolean
}

interface PanelState {
  groups: string[]
  group: string
  memos: Memo[]
  loading: boolean
  error?: string
}

function click(event: MouseEvent, action: () => void): void {
  if (event.button !== 0) return
  event.stopPropagation()
  action()
}

function memoTitle(memo: Memo): string {
  const firstLine: string | undefined = memo.content.split(/\r?\n/).find((line: string): boolean => line.trim().length > 0)
  const title: string = (firstLine ?? "Untitled memo").replace(/^\s{0,3}#{1,6}\s+/, "").trim()
  return title.length > 48 ? `${title.slice(0, 45)}…` : title
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unable to read memos"
}

function MemoDetail(props: {
  context: Plugin.Context
  repository: MemoRepository
  group: string
  memo: Memo
  onChanged: () => Promise<void>
}): JSX.Element {
  const [terminalHeight, setTerminalHeight]: [Accessor<number>, Setter<number>] = createSignal<number>(props.context.renderer.terminalHeight)
  let scroll: ScrollBoxRenderable | undefined
  const onResize: () => void = (): void => { setTerminalHeight(props.context.renderer.terminalHeight) }
  const closeAndRefresh: () => Promise<void> = async (): Promise<void> => {
    props.context.ui.dialog.clear()
    await props.onChanged()
  }
  const toggleChecked: () => Promise<void> = async (): Promise<void> => {
    try {
      await props.repository.setChecked(props.group, props.memo.id, !props.memo.checked)
      await closeAndRefresh()
    } catch (error: unknown) {
      props.context.ui.toast.show({ title: "Memos", message: errorMessage(error), variant: "error" })
    }
  }
  const changeDeleted: (deleted: boolean) => Promise<void> = async (deleted: boolean): Promise<void> => {
    try {
      const confirmed: boolean = (await props.context.ui.dialog.confirm({
        title: deleted ? "Hide this memo?" : "Restore this memo?",
        message: deleted ? "It will be hidden from the active memo list." : "It will reappear in the active memo list.",
        label: { confirm: deleted ? "Hide" : "Restore", cancel: "Cancel" },
      })) ?? false
      if (!confirmed) return
      await props.repository.setDeleted(props.group, props.memo.id, deleted)
      await closeAndRefresh()
    } catch (error: unknown) {
      props.context.ui.toast.show({ title: "Memos", message: errorMessage(error), variant: "error" })
    }
  }

  props.context.keymap.layer(() => ({
    mode: "modal",
    commands: [
      { bind: "x", run: (): Promise<void> => toggleChecked() },
      { bind: "d", run: (): Promise<void> => changeDeleted(true) },
      { bind: "r", run: (): Promise<void> => changeDeleted(false) },
      { bind: "pageup", run: (): void => { scroll?.scrollBy(-Math.max(1, Math.floor(scroll.viewport.height / 2)), "absolute") } },
      { bind: "pagedown", run: (): void => { scroll?.scrollBy(Math.max(1, Math.floor(scroll.viewport.height / 2)), "absolute") } },
      { bind: "up", run: (): void => { scroll?.scrollBy(-1, "absolute") } },
      { bind: "down", run: (): void => { scroll?.scrollBy(1, "absolute") } },
    ],
  }))

  onMount((): void => {
    props.context.ui.dialog.set({ size: "xlarge", centered: true })
    props.context.renderer.on("resize", onResize)
  })
  onCleanup((): void => { props.context.renderer.off("resize", onResize) })

  const content: string = props.memo.content || "(empty memo)"
  const contentHeight: number = Math.max(1, content.split("\n").length)
  return (
    <box padding={1} gap={1}>
      <text fg={props.context.theme.text.base} wrapMode="none" truncate height={1}>
        <b>{props.memo.checked ? "✓" : "○"} {memoTitle(props.memo)}</b>
      </text>
      <scrollbox ref={(value: ScrollBoxRenderable): void => { scroll = value }} focused
        height={Math.max(3, terminalHeight() - 10)} scrollY scrollX>
        <text fg={props.context.theme.text.base} wrapMode="none" flexShrink={0} height={contentHeight}>{content}</text>
      </scrollbox>
      <text fg={props.context.theme.text.muted} wrapMode="none" truncate>
        ↑↓/PgUp/PgDn scroll · x check/uncheck · {props.memo.deleted ? "r restore" : "d hide"} · Esc close
      </text>
    </box>
  )
}

function MemosPanel(props: {
  context: Plugin.Context
  repository: MemoRepository
  preferences: Store<PanelPreferences>
  updatePreferences: (mutation: (draft: PanelPreferences) => void) => void
}): JSX.Element {
  const initialGroup: string = props.preferences.group || "personal"
  const [state, setState]: [Accessor<PanelState>, Setter<PanelState>] = createSignal<PanelState>({
    groups: [initialGroup], group: initialGroup, memos: [], loading: true,
  })
  let requestID: number = 0

  const refresh: (preferredGroup: string) => Promise<void> = async (preferredGroup: string): Promise<void> => {
    const currentRequest: number = ++requestID
    setState((current: PanelState): PanelState => ({ ...current, loading: true, error: undefined }))
    try {
      const groups: string[] = await props.repository.listGroups()
      const group: string = groups.includes(preferredGroup) ? preferredGroup : groups[0] ?? "personal"
      if (group !== props.preferences.group) {
        props.updatePreferences((draft: PanelPreferences): void => { draft.group = group })
      }
      const data = await props.repository.read(group)
      if (currentRequest !== requestID) return
      setState({ groups, group, memos: data.memos, loading: false })
    } catch (error: unknown) {
      if (currentRequest !== requestID) return
      setState((current: PanelState): PanelState => ({ ...current, loading: false, error: errorMessage(error) }))
    }
  }

  createEffect((): void => {
    void refresh(props.preferences.group || "personal")
  })
  onCleanup((): void => { requestID += 1 })

  const chooseGroup: () => Promise<void> = async (): Promise<void> => {
    try {
      const options = state().groups.map((group: string) => ({ title: group, value: group }))
      const group: string | undefined = await props.context.ui.dialog.select<string>({ title: "Memo group", options })
      if (group) props.updatePreferences((draft: PanelPreferences): void => { draft.group = group })
    } catch (error: unknown) {
      props.context.ui.toast.show({ title: "Memos", message: errorMessage(error), variant: "error" })
    }
  }

  const addMemo: () => Promise<void> = async (): Promise<void> => {
    try {
      const content: string | undefined = await props.context.ui.dialog.prompt({ title: "New memo", placeholder: "Memo text" })
      if (content === undefined || content.trim().length === 0) return
      await props.repository.add(state().group, content)
      await refresh(state().group)
    } catch (error: unknown) {
      props.context.ui.toast.show({ title: "Memos", message: errorMessage(error), variant: "error" })
    }
  }

  const toggleChecked: (memo: Memo) => Promise<void> = async (memo: Memo): Promise<void> => {
    try {
      await props.repository.setChecked(state().group, memo.id, !memo.checked)
      await refresh(state().group)
    } catch (error: unknown) {
      props.context.ui.toast.show({ title: "Memos", message: errorMessage(error), variant: "error" })
    }
  }

  const changeDeleted: (memo: Memo, deleted: boolean) => Promise<void> = async (memo: Memo, deleted: boolean): Promise<void> => {
    try {
      const confirmed: boolean = (await props.context.ui.dialog.confirm({
        title: deleted ? "Hide this memo?" : "Restore this memo?",
        message: deleted ? "It will be hidden from the active memo list." : "It will reappear in the active memo list.",
        label: { confirm: deleted ? "Hide" : "Restore", cancel: "Cancel" },
      })) ?? false
      if (!confirmed) return
      await props.repository.setDeleted(state().group, memo.id, deleted)
      await refresh(state().group)
    } catch (error: unknown) {
      props.context.ui.toast.show({ title: "Memos", message: errorMessage(error), variant: "error" })
    }
  }

  const openMemo: (memo: Memo) => void = (memo: Memo): void => {
    props.context.ui.dialog.show((): JSX.Element => (
      <MemoDetail context={props.context} repository={props.repository} group={state().group} memo={memo}
        onChanged={(): Promise<void> => refresh(state().group)} />
    ))
  }

  const visibleMemos: () => Memo[] = (): Memo[] => state().memos.filter((memo: Memo): boolean => props.preferences.showDeleted || !memo.deleted)

  return (
    <box>
      <text fg={props.context.theme.text.base} wrapMode="none" truncate height={1}
        onMouseDown={(event: MouseEvent): void => click(event, (): void => props.updatePreferences((draft: PanelPreferences): void => { draft.collapsed = !draft.collapsed }))}>
        <b>{props.preferences.collapsed ? "▶" : "▼"} Memos</b>
      </text>
      <Show when={!props.preferences.collapsed}>
        <box flexDirection="row" gap={2}>
          <text fg={props.context.theme.text.muted} wrapMode="none" truncate height={1}
            onMouseUp={(event: MouseEvent): void => click(event, (): void => { void chooseGroup() })}>
            Group: {state().group} ▾
          </text>
          <text fg={props.context.theme.text.muted} height={1} wrapMode="none"
            onMouseUp={(event: MouseEvent): void => click(event, (): void => { void addMemo() })}>+ New</text>
        </box>
        <Show when={state().loading}>
          <text fg={props.context.theme.text.muted}>Loading memos…</text>
        </Show>
        <Show when={state().error}>
          <text fg="#ff7b86" maxHeight={2}>{state().error}</text>
        </Show>
        <Show when={!state().loading && !state().error && visibleMemos().length === 0}>
          <text fg={props.context.theme.text.muted}>No memos in this group.</text>
        </Show>
        <For each={visibleMemos()}>{(memo: Memo): JSX.Element => (
          <box flexDirection="row" gap={1}>
            <text fg={props.context.theme.text.muted} wrapMode="none" height={1}
              onMouseUp={(event: MouseEvent): void => click(event, (): void => { void (memo.deleted ? changeDeleted(memo, false) : toggleChecked(memo)) })}>
              {memo.deleted ? "↶" : memo.checked ? "✓" : "○"}
            </text>
            <text fg={memo.deleted ? props.context.theme.text.muted : props.context.theme.text.base}
              wrapMode="none" truncate height={1}
              onMouseUp={(event: MouseEvent): void => click(event, (): void => openMemo(memo))}>
              {memoTitle(memo)}
            </text>
            <Show when={!memo.deleted}>
              <text fg={props.context.theme.text.muted} wrapMode="none" height={1}
                onMouseUp={(event: MouseEvent): void => click(event, (): void => { void changeDeleted(memo, true) })}>×</text>
            </Show>
          </box>
        )}</For>
        <box flexDirection="row" gap={2}>
          <text fg={props.context.theme.text.muted} height={1} wrapMode="none"
            onMouseUp={(event: MouseEvent): void => click(event, (): void => props.updatePreferences((draft: PanelPreferences): void => { draft.showDeleted = !draft.showDeleted }))}>
            {props.preferences.showDeleted ? "Hide deleted" : "Show deleted"}
          </text>
          <text fg={props.context.theme.text.muted} height={1} wrapMode="none"
            onMouseUp={(event: MouseEvent): void => click(event, (): void => { void refresh(state().group) })}>↻ Refresh</text>
        </box>
      </Show>
    </box>
  )
}

export default Plugin.define({
  id: "opencode-memos",
  setup(context: Plugin.Context): () => void {
    const [preferences, updatePreferences]: readonly [Store<PanelPreferences>, (mutation: (draft: PanelPreferences) => void) => void] =
      context.storage.memory<PanelPreferences>("panel", { initial: { collapsed: false, group: "personal", showDeleted: false } })
    const repository: MemoRepository = new MemoRepository()
    return context.ui.slot({
      prepend: "sidebar.content",
      render: (): JSX.Element => <MemosPanel context={context} repository={repository} preferences={preferences} updatePreferences={updatePreferences} />,
    })
  },
})
