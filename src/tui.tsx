/** @jsxImportSource @opentui/solid */
import { Plugin } from "@opencode/plugin/tui"
import type { MouseEvent, ScrollBoxRenderable, TextareaRenderable } from "@opentui/core"
import type { JSX } from "@opentui/solid"
import { createEffect, createSignal, For, onCleanup, onMount, Show, type Accessor, type Setter } from "solid-js"
import type { Store } from "solid-js/store"
import { isValidGroupName, MemoRepository } from "./store.ts"
import type { Memo } from "./model.ts"
import { editorCommand, editInEditor, type ExternalEditResult } from "./editor.ts"

interface PanelPreferences {
  collapsed: boolean
  showDeleted: boolean
}

interface GroupMemos {
  name: string
  memos: Memo[]
  error?: string
}

interface PanelState {
  groups: GroupMemos[]
  loading: boolean
  error?: string
}

function click(event: MouseEvent, action: () => void): void {
  if (event.button !== 0) return
  event.stopPropagation()
  action()
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
  const deletePermanently: () => Promise<void> = async (): Promise<void> => {
    try {
      const confirmed: boolean = (await props.context.ui.dialog.confirm({
        title: "Delete this memo?",
        message: "This permanently removes the memo and cannot be undone.",
        label: { confirm: "Delete", cancel: "Cancel" },
      })) ?? false
      if (!confirmed) return
      await props.repository.deleteMemo(props.group, props.memo.id)
      await closeAndRefresh()
    } catch (error: unknown) {
      props.context.ui.toast.show({ title: "Memos", message: errorMessage(error), variant: "error" })
    }
  }
  const showDetail: () => void = (): void => {
    props.context.ui.dialog.show((): JSX.Element => (
      <MemoDetail context={props.context} repository={props.repository} group={props.group} memo={props.memo} onChanged={props.onChanged} />
    ))
  }
  const editMemo: () => void = (): void => {
    openMemoEditor(props.context, {
      initialTitle: props.memo.title,
      initialContent: props.memo.content,
      onCancel: showDetail,
      onSave: async (title: string, content: string): Promise<void> => {
        await props.repository.updateMemo(props.group, props.memo.id, title, content)
        await props.onChanged()
      },
    })
  }

  props.context.keymap.layer(() => ({
    mode: "modal",
    commands: [
      { bind: "x", run: (): Promise<void> => toggleChecked() },
      { bind: "d", run: (): Promise<void> => changeDeleted(true) },
      { bind: "r", run: (): Promise<void> => changeDeleted(false) },
      { bind: "e", run: (): void => editMemo() },
      { bind: "shift+d", run: (): Promise<void> => deletePermanently() },
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
    <box padding={2} gap={1}>
      <box flexDirection="row" gap={1} height={1}>
        <text fg={props.memo.checked ? props.context.theme.text.feedback.success.base : props.context.theme.text.muted} wrapMode="none" height={1}>
          <b>{props.memo.checked ? "✓" : "○"}</b>
        </text>
        <text fg={props.context.theme.hue.accent[400]} wrapMode="none" truncate height={1}>
          <b>{props.memo.title}</b>
        </text>
      </box>
      <scrollbox ref={(value: ScrollBoxRenderable): void => { scroll = value }} focused
        border borderColor={props.context.theme.border.base} padding={1}
        height={Math.max(3, terminalHeight() - 12)} scrollY scrollX>
        <text fg={props.context.theme.text.base} wrapMode="none" flexShrink={0} height={contentHeight}>{content}</text>
      </scrollbox>
      <text fg={props.context.theme.text.muted} wrapMode="none" truncate>
        ↑↓/PgUp/PgDn scroll · e edit · x check/uncheck · {props.memo.deleted ? "r restore" : "d hide"} · shift+d delete · Esc close
      </text>
    </box>
  )
}

function MemoContentEditor(props: {
  context: Plugin.Context
  initialContent: string
  onSave: (content: string) => Promise<void>
  onCancel: () => void
}): JSX.Element {
  const [terminalHeight, setTerminalHeight]: [Accessor<number>, Setter<number>] = createSignal<number>(props.context.renderer.terminalHeight)
  const [content, setContent]: [Accessor<string>, Setter<string>] = createSignal<string>(props.initialContent)
  const [saving, setSaving]: [Accessor<boolean>, Setter<boolean>] = createSignal<boolean>(false)
  let editor: TextareaRenderable | undefined
  const onResize: () => void = (): void => { setTerminalHeight(props.context.renderer.terminalHeight) }
  const focusContent: (event: MouseEvent) => void = (event: MouseEvent): void => {
    if (event.button === 0) editor?.focus()
  }
  const contentChanged: (value: unknown) => void = (value: unknown): void => {
    setContent(typeof value === "string" ? value : editor?.plainText ?? content())
  }
  const save: () => Promise<void> = async (): Promise<void> => {
    if (saving()) return
    setSaving(true)
    try {
      await props.onSave(content())
      setSaving(false)
      props.context.ui.dialog.clear()
    } catch (error: unknown) {
      setSaving(false)
      props.context.ui.toast.show({ title: "Memos", message: errorMessage(error), variant: "error" })
    }
  }

  onMount((): void => {
    props.context.ui.dialog.set({ size: "xlarge", centered: true })
    props.context.renderer.on("resize", onResize)
  })
  onCleanup((): void => { props.context.renderer.off("resize", onResize) })

  return (
    <box padding={1} gap={1}>
      <text fg={props.context.theme.text.base} wrapMode="none" truncate height={1}>
        <b>Content</b>
      </text>
      <textarea ref={(value: TextareaRenderable): void => { editor = value }} initialValue={props.initialContent} placeholder="Write memo content…" wrapMode="word"
        keyBindings={[
          { name: "return", action: "submit" },
          { name: "kpenter", action: "submit" },
          { name: "linefeed", action: "submit" },
          { name: "return", ctrl: true, action: "newline" },
          { name: "kpenter", ctrl: true, action: "newline" },
          { name: "linefeed", ctrl: true, action: "newline" },
        ]}
        onSubmit={(): void => { void save() }}
        height={Math.max(5, terminalHeight() - 8)}
        onMouseDown={focusContent} onContentChange={contentChanged} />
      <box flexDirection="row" gap={2}>
        <text fg={props.context.theme.text.action.primary.base} height={1} wrapMode="none"
          onMouseUp={(event: MouseEvent): void => click(event, (): void => { void save() })}>
          {saving() ? "Saving…" : "Save"}
        </text>
        <text fg={props.context.theme.text.muted} height={1} wrapMode="none"
          onMouseUp={(event: MouseEvent): void => click(event, props.onCancel)}>Cancel</text>
        <text fg={props.context.theme.text.muted} height={1} wrapMode="none" truncate>
          Enter save · Ctrl+Enter newline · Esc cancel
        </text>
      </box>
    </box>
  )
}

function openMemoEditor(context: Plugin.Context, options: {
  initialTitle: string
  initialContent: string
  onSave: (title: string, content: string) => Promise<void>
  onCancel?: () => void
}): void {
  const cancel: () => void = (): void => {
    if (options.onCancel) options.onCancel()
    else context.ui.dialog.clear()
  }

  const showContentEditor: (title: string) => void = (title: string): void => {
    context.ui.dialog.show((): JSX.Element => (
      <MemoContentEditor context={context} initialContent={options.initialContent}
        onSave={async (content: string): Promise<void> => { await options.onSave(title, content) }}
        onCancel={cancel} />
    ))
  }

  const editInDefaultEditor: (title: string, command: string) => Promise<void> = async (title: string, command: string): Promise<void> => {
    context.ui.dialog.clear()
    const result: ExternalEditResult = await editInEditor(context, command, options.initialContent)
    if (result.status === "saved") {
      try {
        await options.onSave(title, result.content)
      } catch (error: unknown) {
        context.ui.toast.show({ title: "Memos", message: errorMessage(error), variant: "error" })
      }
      return
    }
    if (result.status === "failed") {
      context.ui.toast.show({ title: "Memos", message: result.message, variant: "error" })
      showContentEditor(title)
      return
    }
    cancel()
  }

  const startContent: (title: string) => void = (title: string): void => {
    const command: string | undefined = editorCommand()
    if (command === undefined) {
      showContentEditor(title)
      return
    }
    void editInDefaultEditor(title, command)
  }

  const promptTitle: () => Promise<void> = async (): Promise<void> => {
    let current: string = options.initialTitle
    for (;;) {
      const raw: string | undefined = await context.ui.dialog.prompt({
        title: "Memo title",
        placeholder: "Memo title",
        value: current,
      })
      if (raw === undefined) {
        cancel()
        return
      }
      const clean: string = raw.trim()
      if (clean.length === 0) {
        context.ui.toast.show({ title: "Memos", message: "A memo title is required", variant: "error" })
        current = ""
        continue
      }
      startContent(clean)
      return
    }
  }

  void promptTitle()
}

function MemosPanel(props: {
  context: Plugin.Context
  repository: MemoRepository
  preferences: Store<PanelPreferences>
  updatePreferences: (mutation: (draft: PanelPreferences) => void) => void
}): JSX.Element {
  const [state, setState]: [Accessor<PanelState>, Setter<PanelState>] = createSignal<PanelState>({
    groups: [], loading: true,
  })
  let requestID: number = 0

  const refresh: () => Promise<void> = async (): Promise<void> => {
    const currentRequest: number = ++requestID
    setState((current: PanelState): PanelState => ({ ...current, loading: true, error: undefined }))
    try {
      const names: string[] = await props.repository.listGroups()
      const groups: GroupMemos[] = await Promise.all(names.map(async (name: string): Promise<GroupMemos> => {
        try {
          const data = await props.repository.read(name)
          return { name, memos: data.memos }
        } catch (error: unknown) {
          return { name, memos: [], error: errorMessage(error) }
        }
      }))
      if (currentRequest !== requestID) return
      setState({ groups, loading: false })
    } catch (error: unknown) {
      if (currentRequest !== requestID) return
      setState((current: PanelState): PanelState => ({ ...current, loading: false, error: errorMessage(error) }))
    }
  }

  createEffect((): void => {
    void refresh()
  })
  onCleanup((): void => { requestID += 1 })

  const addMemo: (group: string) => void = (group: string): void => {
    openMemoEditor(props.context, {
      initialTitle: "",
      initialContent: "",
      onSave: async (title: string, content: string): Promise<void> => {
        await props.repository.add(group, title, content)
        await refresh()
      },
    })
  }

  const validGroupName: (name: string) => boolean = (name: string): boolean => {
    if (isValidGroupName(name)) return true
    props.context.ui.toast.show({ title: "Memos", message: "Use letters, numbers, _ or -; start with a letter or number", variant: "error" })
    return false
  }

  const createGroup: () => Promise<void> = async (): Promise<void> => {
    let current: string = ""
    for (;;) {
      const raw: string | undefined = await props.context.ui.dialog.prompt({
        title: "Create memo group",
        placeholder: "personal",
        value: current,
      })
      if (raw === undefined) return
      const name: string = raw.trim()
      if (!validGroupName(name)) {
        current = name
        continue
      }
      try {
        await props.repository.createGroup(name)
        await refresh()
        return
      } catch (error: unknown) {
        props.context.ui.toast.show({ title: "Memos", message: errorMessage(error), variant: "error" })
        return
      }
    }
  }

  const manageGroup: (group: string) => Promise<void> = async (group: string): Promise<void> => {
    const action: string | undefined = await props.context.ui.dialog.select({
      title: `${group} group`,
      options: [
        { title: "Rename", value: "rename" },
        { title: "Delete", value: "delete" },
      ],
    })
    if (action === "rename") {
      let current: string = group
      for (;;) {
        const raw: string | undefined = await props.context.ui.dialog.prompt({
          title: `Rename ${group} group`,
          value: current,
        })
        if (raw === undefined) return
        const newName: string = raw.trim()
        if (!validGroupName(newName)) {
          current = newName
          continue
        }
        try {
          if (newName !== group && (await props.repository.listGroups()).includes(newName)) {
            props.context.ui.toast.show({ title: "Memos", message: `Group ${newName} already exists`, variant: "error" })
            current = newName
            continue
          }
          await props.repository.renameGroup(group, newName)
          await refresh()
        } catch (error: unknown) {
          props.context.ui.toast.show({ title: "Memos", message: errorMessage(error), variant: "error" })
        }
        return
      }
    }
    if (action !== "delete") return
    try {
      const data = await props.repository.read(group)
      const confirmed: boolean = (await props.context.ui.dialog.confirm({
        title: `Delete ${group} group?`,
        message: `This permanently deletes ${data.memos.length} memo${data.memos.length === 1 ? "" : "s"} (including hidden ones) and the group. This cannot be undone. Other files will not be removed.`,
        label: { confirm: "Delete", cancel: "Cancel" },
      })) ?? false
      if (!confirmed) return
      await props.repository.deleteGroup(group)
      await refresh()
    } catch (error: unknown) {
      props.context.ui.toast.show({ title: "Memos", message: errorMessage(error), variant: "error" })
    }
  }

  const toggleChecked: (group: string, memo: Memo) => Promise<void> = async (group: string, memo: Memo): Promise<void> => {
    try {
      await props.repository.setChecked(group, memo.id, !memo.checked)
      await refresh()
    } catch (error: unknown) {
      props.context.ui.toast.show({ title: "Memos", message: errorMessage(error), variant: "error" })
    }
  }

  const changeDeleted: (group: string, memo: Memo, deleted: boolean) => Promise<void> = async (group: string, memo: Memo, deleted: boolean): Promise<void> => {
    try {
      const confirmed: boolean = (await props.context.ui.dialog.confirm({
        title: deleted ? "Hide this memo?" : "Restore this memo?",
        message: deleted ? "It will be hidden from the active memo list." : "It will reappear in the active memo list.",
        label: { confirm: deleted ? "Hide" : "Restore", cancel: "Cancel" },
      })) ?? false
      if (!confirmed) return
      await props.repository.setDeleted(group, memo.id, deleted)
      await refresh()
    } catch (error: unknown) {
      props.context.ui.toast.show({ title: "Memos", message: errorMessage(error), variant: "error" })
    }
  }

  const deleteMemoPermanently: (group: string, memo: Memo) => Promise<void> = async (group: string, memo: Memo): Promise<void> => {
    try {
      const confirmed: boolean = (await props.context.ui.dialog.confirm({
        title: "Delete this memo?",
        message: "This permanently removes the memo and cannot be undone.",
        label: { confirm: "Delete", cancel: "Cancel" },
      })) ?? false
      if (!confirmed) return
      await props.repository.deleteMemo(group, memo.id)
      await refresh()
    } catch (error: unknown) {
      props.context.ui.toast.show({ title: "Memos", message: errorMessage(error), variant: "error" })
    }
  }

  const openMemo: (group: string, memo: Memo) => void = (group: string, memo: Memo): void => {
    props.context.ui.dialog.show((): JSX.Element => (
      <MemoDetail context={props.context} repository={props.repository} group={group} memo={memo}
        onChanged={(): Promise<void> => refresh()} />
    ))
  }

  const visibleMemos: (group: GroupMemos) => Memo[] = (group: GroupMemos): Memo[] =>
    group.memos.filter((memo: Memo): boolean => props.preferences.showDeleted || !memo.deleted)

  return (
    <box>
      <box flexDirection="row" gap={2}>
        <text fg={props.context.theme.text.base} wrapMode="none" truncate height={1}
          onMouseDown={(event: MouseEvent): void => click(event, (): void => props.updatePreferences((draft: PanelPreferences): void => { draft.collapsed = !draft.collapsed }))}>
          <b>{props.preferences.collapsed ? "▶" : "▼"} Memos</b>
        </text>
        <Show when={!props.preferences.collapsed}>
          <text fg={props.context.theme.hue.accent[400]} height={1} wrapMode="none"
            onMouseUp={(event: MouseEvent): void => click(event, (): void => { void createGroup() })}>+ Group</text>
        </Show>
      </box>
      <Show when={!props.preferences.collapsed}>
        <Show when={state().loading}>
          <text fg={props.context.theme.text.muted}>Loading memos…</text>
        </Show>
        <Show when={state().error}>
          <text fg={props.context.theme.text.feedback.error.base} maxHeight={2}>{state().error}</text>
        </Show>
        <Show when={!state().loading && !state().error && state().groups.length === 0}>
          <text fg={props.context.theme.text.muted}>No memo groups yet.</text>
          <text fg={props.context.theme.hue.accent[400]} height={1} wrapMode="none"
            onMouseUp={(event: MouseEvent): void => click(event, (): void => { void createGroup() })}>+ Create group</text>
        </Show>
        <For each={state().groups}>{(group: GroupMemos): JSX.Element => (
          <box>
            <box flexDirection="row" gap={2}>
              <text fg={props.context.theme.hue.accent[400]} wrapMode="none" truncate height={1}>
                <b>{group.name}</b>
              </text>
              <text fg={props.context.theme.hue.accent[400]} height={1} wrapMode="none"
                onMouseUp={(event: MouseEvent): void => click(event, (): void => { void addMemo(group.name) })}>+ New</text>
              <text fg={props.context.theme.text.muted} height={1} wrapMode="none"
                onMouseUp={(event: MouseEvent): void => click(event, (): void => { void manageGroup(group.name) })}>⋯</text>
            </box>
            <Show when={group.error}>
              <text fg={props.context.theme.text.feedback.error.base} maxHeight={2}>{group.error}</text>
            </Show>
            <Show when={!group.error && visibleMemos(group).length === 0}>
              <text fg={props.context.theme.text.muted}>{props.preferences.showDeleted ? "No memos." : "No active memos."}</text>
            </Show>
            <For each={visibleMemos(group)}>{(memo: Memo): JSX.Element => (
              <box flexDirection="row" gap={1}>
                <text fg={memo.deleted ? props.context.theme.text.feedback.warning.base : memo.checked ? props.context.theme.text.feedback.success.base : props.context.theme.text.muted} wrapMode="none" height={1}
                  onMouseUp={(event: MouseEvent): void => click(event, (): void => { void (memo.deleted ? changeDeleted(group.name, memo, false) : toggleChecked(group.name, memo)) })}>
                  {memo.deleted ? "↶" : memo.checked ? "✓" : "○"}
                </text>
                <text fg={memo.deleted ? props.context.theme.text.muted : props.context.theme.text.base}
                  wrapMode="none" truncate height={1}
                  onMouseUp={(event: MouseEvent): void => click(event, (): void => openMemo(group.name, memo))}>
                  {memo.title}
                </text>
                <text fg={memo.deleted ? props.context.theme.text.feedback.error.base : props.context.theme.text.feedback.error.muted} wrapMode="none" height={1} paddingX={1}
                  onMouseUp={(event: MouseEvent): void => click(event, (): void => { void (memo.deleted ? deleteMemoPermanently(group.name, memo) : changeDeleted(group.name, memo, true)) })}>
                  {memo.deleted ? "🗑" : "×"}
                </text>
              </box>
            )}</For>
          </box>
        )}</For>
        <box flexDirection="row" gap={2}>
          <Show when={state().groups.length > 0}>
            <text fg={props.context.theme.text.muted} height={1} wrapMode="none"
              onMouseUp={(event: MouseEvent): void => click(event, (): void => props.updatePreferences((draft: PanelPreferences): void => { draft.showDeleted = !draft.showDeleted }))}>
              {props.preferences.showDeleted ? "Hide deleted" : "Show deleted"}
            </text>
          </Show>
          <text fg={props.context.theme.text.muted} height={1} wrapMode="none"
            onMouseUp={(event: MouseEvent): void => click(event, (): void => { void refresh() })}>↻ Refresh</text>
        </box>
      </Show>
    </box>
  )
}

export default Plugin.define({
  id: "opencode-memos",
  setup(context: Plugin.Context): () => void {
    const [preferences, updatePreferences]: readonly [Store<PanelPreferences>, (mutation: (draft: PanelPreferences) => void) => void] =
      context.storage.memory<PanelPreferences>("panel", { initial: { collapsed: false, showDeleted: false } })
    const repository: MemoRepository = new MemoRepository()
    return context.ui.slot({
      prepend: "sidebar.content",
      render: (): JSX.Element => <MemosPanel context={context} repository={repository} preferences={preferences} updatePreferences={updatePreferences} />,
    })
  },
})
