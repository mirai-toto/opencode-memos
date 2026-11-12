// @bun
// src/tui.tsx
import { effect as _$effect } from "@opentui/solid";
import { createTextNode as _$createTextNode } from "@opentui/solid";
import { use as _$use } from "@opentui/solid";
import { insertNode as _$insertNode } from "@opentui/solid";
import { insert as _$insert } from "@opentui/solid";
import { memo as _$memo } from "@opentui/solid";
import { setProp as _$setProp } from "@opentui/solid";
import { createElement as _$createElement } from "@opentui/solid";
import { createComponent as _$createComponent } from "@opentui/solid";
import { Plugin } from "@opencode/plugin/tui";
import { createEffect, createSignal, For, onCleanup, onMount, Show } from "solid-js";

// src/store.ts
import { randomUUID } from "crypto";
import { mkdir, readdir, readFile, rename, rm, rmdir, unlink, writeFile } from "fs/promises";
import { homedir } from "os";
import { join, resolve } from "path";

// src/model.ts
function emptyMemoGroup() {
  return { version: 2, memos: [] };
}
function parseMemoGroup(text, source) {
  let value;
  try {
    value = JSON.parse(text);
  } catch (error) {
    throw new Error(`${source} is not valid JSON`, { cause: error });
  }
  if (!isRecord(value))
    throw new Error(`${source} must contain a JSON object`);
  if (value.version !== 2)
    throw new Error(`${source} has unsupported version ${String(value.version)}`);
  if (!Array.isArray(value.memos))
    throw new Error(`${source} must contain a memos array`);
  const seen = new Set;
  const memos = value.memos.map((entry, index) => {
    if (!isRecord(entry))
      throw new Error(`${source} memo ${index + 1} must be an object`);
    if (typeof entry.id !== "string" || entry.id.length === 0) {
      throw new Error(`${source} memo ${index + 1} must have a non-empty id`);
    }
    if (seen.has(entry.id))
      throw new Error(`${source} contains duplicate memo id ${entry.id}`);
    if (typeof entry.title !== "string" || entry.title.trim().length === 0) {
      throw new Error(`${source} memo ${entry.id} must have a non-empty title`);
    }
    if (typeof entry.checked !== "boolean")
      throw new Error(`${source} memo ${entry.id} must have a boolean checked field`);
    if (typeof entry.deleted !== "boolean")
      throw new Error(`${source} memo ${entry.id} must have a boolean deleted field`);
    if (typeof entry.content !== "string")
      throw new Error(`${source} memo ${entry.id} must have string content`);
    seen.add(entry.id);
    return { id: entry.id, title: entry.title, checked: entry.checked, deleted: entry.deleted, content: entry.content };
  });
  return { version: 2, memos };
}
function serializeMemoGroup(group) {
  if (group.version !== 2)
    throw new Error(`Unsupported memo group version ${String(group.version)}`);
  const seen = new Set;
  for (const memo of group.memos) {
    if (typeof memo.id !== "string" || memo.id.length === 0)
      throw new Error("Memo id must not be empty");
    if (seen.has(memo.id))
      throw new Error(`Duplicate memo id ${memo.id}`);
    if (typeof memo.title !== "string" || memo.title.trim().length === 0) {
      throw new Error(`Memo ${memo.id} must have a non-empty title`);
    }
    if (typeof memo.checked !== "boolean" || typeof memo.deleted !== "boolean" || typeof memo.content !== "string") {
      throw new Error(`Memo ${memo.id} has invalid fields`);
    }
    seen.add(memo.id);
  }
  return `${JSON.stringify(group, null, 2)}
`;
}
function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// src/store.ts
class MemoRepository {
  rootDirectory;
  idFactory;
  constructor(rootDirectory = join(homedir(), ".memos"), idFactory = randomUUID) {
    this.rootDirectory = resolve(rootDirectory);
    this.idFactory = idFactory;
  }
  async listGroups() {
    let entries;
    try {
      entries = await readdir(this.rootDirectory, { withFileTypes: true, encoding: "utf8" });
    } catch (error) {
      if (errorCode(error) === "ENOENT")
        return [];
      throw error;
    }
    const groups = entries.filter((entry) => entry.isDirectory() && isValidGroupName(entry.name)).map((entry) => entry.name).sort((left, right) => left.localeCompare(right));
    return groups;
  }
  async createGroup(group) {
    const directory = this.groupPath(group);
    await mkdir(this.rootDirectory, { recursive: true, mode: 448 });
    await mkdir(directory, { mode: 448 });
    await this.write(group, emptyMemoGroup());
  }
  async deleteGroup(group) {
    const directory = this.groupPath(group);
    const data = await this.read(group);
    if (data.memos.length > 0)
      throw new Error(`Group ${group} still contains memos (including hidden ones)`);
    const entries = await readdir(directory);
    if (entries.some((entry) => entry !== "memos.json")) {
      throw new Error(`Group ${group} contains other files and cannot be deleted`);
    }
    if (entries.includes("memos.json"))
      await unlink(this.dataPath(group));
    await rmdir(directory);
  }
  async read(group) {
    const filePath = this.dataPath(group);
    try {
      const text = await readFile(filePath, "utf8");
      return parseMemoGroup(text, filePath);
    } catch (error) {
      if (errorCode(error) === "ENOENT")
        return emptyMemoGroup();
      throw error;
    }
  }
  async add(group, title, content) {
    const current = await this.read(group);
    const memo = { id: this.idFactory(), title, checked: false, deleted: false, content };
    await this.write(group, { version: 2, memos: [...current.memos, memo] });
    return memo;
  }
  async updateTitle(group, memoID, title) {
    await this.update(group, memoID, (memo) => ({ ...memo, title }));
  }
  async updateContent(group, memoID, content) {
    await this.update(group, memoID, (memo) => ({ ...memo, content }));
  }
  async updateMemo(group, memoID, title, content) {
    await this.update(group, memoID, (memo) => ({ ...memo, title, content }));
  }
  async setChecked(group, memoID, checked) {
    await this.update(group, memoID, (memo) => ({ ...memo, checked }));
  }
  async setDeleted(group, memoID, deleted) {
    await this.update(group, memoID, (memo) => ({ ...memo, deleted }));
  }
  async deleteMemo(group, memoID) {
    const current = await this.read(group);
    const memos = current.memos.filter((memo) => memo.id !== memoID);
    if (memos.length === current.memos.length)
      throw new Error(`Memo ${memoID} was not found in group ${group}`);
    await this.write(group, { version: 2, memos });
  }
  async update(group, memoID, change) {
    const current = await this.read(group);
    let found = false;
    const memos = current.memos.map((memo) => {
      if (memo.id !== memoID)
        return memo;
      found = true;
      return change(memo);
    });
    if (!found)
      throw new Error(`Memo ${memoID} was not found in group ${group}`);
    await this.write(group, { version: 2, memos });
  }
  async write(group, data) {
    const text = serializeMemoGroup(data);
    const directory = this.groupPath(group);
    await mkdir(directory, { recursive: true, mode: 448 });
    const destination = this.dataPath(group);
    const temporary = join(directory, `.memos-${randomUUID()}.tmp`);
    try {
      await writeFile(temporary, text, { encoding: "utf8", mode: 384, flag: "wx" });
      await rename(temporary, destination);
    } catch (error) {
      await rm(temporary, { force: true }).catch(() => {
        return;
      });
      throw error;
    }
  }
  dataPath(group) {
    return join(this.groupPath(group), "memos.json");
  }
  groupPath(group) {
    if (!isValidGroupName(group))
      throw new Error(`Invalid memo group name: ${group}`);
    return join(this.rootDirectory, group);
  }
}
function isValidGroupName(group) {
  return /^[a-zA-Z0-9][a-zA-Z0-9_-]*$/.test(group);
}
function errorCode(error) {
  if (typeof error !== "object" || error === null || !("code" in error))
    return;
  const code = error.code;
  return typeof code === "string" ? code : undefined;
}

// src/editor.ts
import { spawn } from "child_process";
import { mkdtemp, readFile as readFile2, rm as rm2, writeFile as writeFile2 } from "fs/promises";
import { tmpdir } from "os";
import { join as join2 } from "path";
function editorCommand() {
  for (const name of ["VISUAL", "EDITOR"]) {
    const value = (process.env[name] ?? "").trim();
    if (value.length > 0)
      return value;
  }
  return;
}
function interpretExit(command, exitCode, content) {
  if (exitCode === null)
    return { status: "failed", message: `Could not launch editor "${command}"` };
  if (exitCode === 127)
    return { status: "failed", message: `Editor command not found: ${command}` };
  if (exitCode !== 0)
    return { status: "cancelled" };
  return { status: "saved", content };
}
async function editInEditor(context, command, initialContent) {
  const directory = await mkdtemp(join2(tmpdir(), "opencode-memos-"));
  const filePath = join2(directory, "content.md");
  try {
    await writeFile2(filePath, initialContent, { encoding: "utf8", mode: 384 });
    await context.renderer.suspend();
    let exitCode;
    try {
      exitCode = await spawnEditor(command, filePath);
    } finally {
      await context.renderer.resume();
    }
    const content = exitCode === 0 ? await readFile2(filePath, "utf8") : initialContent;
    return interpretExit(command, exitCode, content);
  } finally {
    await rm2(directory, { recursive: true, force: true }).catch(() => {
      return;
    });
  }
}
function spawnEditor(command, filePath) {
  return new Promise((resolve) => {
    const child = spawn("sh", ["-c", `${command} "$1"`, "opencode-memos", filePath], { stdio: "inherit" });
    child.once("error", () => resolve(null));
    child.once("close", (code) => resolve(code ?? 0));
  });
}

// src/tui.tsx
function click(event, action) {
  if (event.button !== 0)
    return;
  event.stopPropagation();
  action();
}
function errorMessage(error) {
  return error instanceof Error ? error.message : "Unable to read memos";
}
function MemoDetail(props) {
  const [terminalHeight, setTerminalHeight] = createSignal(props.context.renderer.terminalHeight);
  let scroll;
  const onResize = () => {
    setTerminalHeight(props.context.renderer.terminalHeight);
  };
  const closeAndRefresh = async () => {
    props.context.ui.dialog.clear();
    await props.onChanged();
  };
  const toggleChecked = async () => {
    try {
      await props.repository.setChecked(props.group, props.memo.id, !props.memo.checked);
      await closeAndRefresh();
    } catch (error) {
      props.context.ui.toast.show({
        title: "Memos",
        message: errorMessage(error),
        variant: "error"
      });
    }
  };
  const changeDeleted = async (deleted) => {
    try {
      const confirmed = await props.context.ui.dialog.confirm({
        title: deleted ? "Hide this memo?" : "Restore this memo?",
        message: deleted ? "It will be hidden from the active memo list." : "It will reappear in the active memo list.",
        label: {
          confirm: deleted ? "Hide" : "Restore",
          cancel: "Cancel"
        }
      }) ?? false;
      if (!confirmed)
        return;
      await props.repository.setDeleted(props.group, props.memo.id, deleted);
      await closeAndRefresh();
    } catch (error) {
      props.context.ui.toast.show({
        title: "Memos",
        message: errorMessage(error),
        variant: "error"
      });
    }
  };
  const deletePermanently = async () => {
    try {
      const confirmed = await props.context.ui.dialog.confirm({
        title: "Delete this memo?",
        message: "This permanently removes the memo and cannot be undone.",
        label: {
          confirm: "Delete",
          cancel: "Cancel"
        }
      }) ?? false;
      if (!confirmed)
        return;
      await props.repository.deleteMemo(props.group, props.memo.id);
      await closeAndRefresh();
    } catch (error) {
      props.context.ui.toast.show({
        title: "Memos",
        message: errorMessage(error),
        variant: "error"
      });
    }
  };
  const showDetail = () => {
    props.context.ui.dialog.show(() => _$createComponent(MemoDetail, {
      get context() {
        return props.context;
      },
      get repository() {
        return props.repository;
      },
      get group() {
        return props.group;
      },
      get memo() {
        return props.memo;
      },
      get onChanged() {
        return props.onChanged;
      }
    }));
  };
  const editMemo = () => {
    openMemoEditor(props.context, {
      initialTitle: props.memo.title,
      initialContent: props.memo.content,
      onCancel: showDetail,
      onSave: async (title, content) => {
        await props.repository.updateMemo(props.group, props.memo.id, title, content);
        await props.onChanged();
      }
    });
  };
  props.context.keymap.layer(() => ({
    mode: "modal",
    commands: [{
      bind: "x",
      run: () => toggleChecked()
    }, {
      bind: "d",
      run: () => changeDeleted(true)
    }, {
      bind: "r",
      run: () => changeDeleted(false)
    }, {
      bind: "e",
      run: () => editMemo()
    }, {
      bind: "shift+d",
      run: () => deletePermanently()
    }, {
      bind: "pageup",
      run: () => {
        scroll?.scrollBy(-Math.max(1, Math.floor(scroll.viewport.height / 2)), "absolute");
      }
    }, {
      bind: "pagedown",
      run: () => {
        scroll?.scrollBy(Math.max(1, Math.floor(scroll.viewport.height / 2)), "absolute");
      }
    }, {
      bind: "up",
      run: () => {
        scroll?.scrollBy(-1, "absolute");
      }
    }, {
      bind: "down",
      run: () => {
        scroll?.scrollBy(1, "absolute");
      }
    }]
  }));
  onMount(() => {
    props.context.ui.dialog.set({
      size: "xlarge",
      centered: true
    });
    props.context.renderer.on("resize", onResize);
  });
  onCleanup(() => {
    props.context.renderer.off("resize", onResize);
  });
  const content = props.memo.content || "(empty memo)";
  const contentHeight = Math.max(1, content.split(`
`).length);
  return (() => {
    var _el$ = _$createElement("box"), _el$2 = _$createElement("box"), _el$3 = _$createElement("text"), _el$4 = _$createElement("b"), _el$5 = _$createElement("text"), _el$6 = _$createElement("b"), _el$7 = _$createElement("scrollbox"), _el$8 = _$createElement("text"), _el$9 = _$createElement("text"), _el$0 = _$createTextNode(`\u2191\u2193/PgUp/PgDn scroll \xB7 e edit \xB7 x check/uncheck \xB7 `), _el$1 = _$createTextNode(` \xB7 shift+d delete \xB7 Esc close`);
    _$insertNode(_el$, _el$2);
    _$insertNode(_el$, _el$7);
    _$insertNode(_el$, _el$9);
    _$setProp(_el$, "padding", 2);
    _$setProp(_el$, "gap", 1);
    _$insertNode(_el$2, _el$3);
    _$insertNode(_el$2, _el$5);
    _$setProp(_el$2, "flexDirection", "row");
    _$setProp(_el$2, "gap", 1);
    _$setProp(_el$2, "height", 1);
    _$insertNode(_el$3, _el$4);
    _$setProp(_el$3, "wrapMode", "none");
    _$setProp(_el$3, "height", 1);
    _$insert(_el$4, () => props.memo.checked ? "\u2713" : "\u25CB");
    _$insertNode(_el$5, _el$6);
    _$setProp(_el$5, "wrapMode", "none");
    _$setProp(_el$5, "truncate", true);
    _$setProp(_el$5, "height", 1);
    _$insert(_el$6, () => props.memo.title);
    _$insertNode(_el$7, _el$8);
    _$use((value) => {
      scroll = value;
    }, _el$7);
    _$setProp(_el$7, "focused", true);
    _$setProp(_el$7, "border", true);
    _$setProp(_el$7, "padding", 1);
    _$setProp(_el$7, "scrollY", true);
    _$setProp(_el$7, "scrollX", true);
    _$setProp(_el$8, "wrapMode", "none");
    _$setProp(_el$8, "flexShrink", 0);
    _$setProp(_el$8, "height", contentHeight);
    _$insert(_el$8, content);
    _$insertNode(_el$9, _el$0);
    _$insertNode(_el$9, _el$1);
    _$setProp(_el$9, "wrapMode", "none");
    _$setProp(_el$9, "truncate", true);
    _$insert(_el$9, () => props.memo.deleted ? "r restore" : "d hide", _el$1);
    _$effect((_p$) => {
      var _v$ = props.memo.checked ? props.context.theme.text.feedback.success.base : props.context.theme.text.muted, _v$2 = props.context.theme.hue.accent[400], _v$3 = props.context.theme.border.base, _v$4 = Math.max(3, terminalHeight() - 12), _v$5 = props.context.theme.text.base, _v$6 = props.context.theme.text.muted;
      _v$ !== _p$.e && (_p$.e = _$setProp(_el$3, "fg", _v$, _p$.e));
      _v$2 !== _p$.t && (_p$.t = _$setProp(_el$5, "fg", _v$2, _p$.t));
      _v$3 !== _p$.a && (_p$.a = _$setProp(_el$7, "borderColor", _v$3, _p$.a));
      _v$4 !== _p$.o && (_p$.o = _$setProp(_el$7, "height", _v$4, _p$.o));
      _v$5 !== _p$.i && (_p$.i = _$setProp(_el$8, "fg", _v$5, _p$.i));
      _v$6 !== _p$.n && (_p$.n = _$setProp(_el$9, "fg", _v$6, _p$.n));
      return _p$;
    }, {
      e: undefined,
      t: undefined,
      a: undefined,
      o: undefined,
      i: undefined,
      n: undefined
    });
    return _el$;
  })();
}
function MemoContentEditor(props) {
  const [terminalHeight, setTerminalHeight] = createSignal(props.context.renderer.terminalHeight);
  const [content, setContent] = createSignal(props.initialContent);
  const [saving, setSaving] = createSignal(false);
  let editor;
  const onResize = () => {
    setTerminalHeight(props.context.renderer.terminalHeight);
  };
  const focusContent = (event) => {
    if (event.button === 0)
      editor?.focus();
  };
  const contentChanged = (value) => {
    setContent(typeof value === "string" ? value : editor?.plainText ?? content());
  };
  const save = async () => {
    if (saving())
      return;
    setSaving(true);
    try {
      await props.onSave(content());
      setSaving(false);
      props.context.ui.dialog.clear();
    } catch (error) {
      setSaving(false);
      props.context.ui.toast.show({
        title: "Memos",
        message: errorMessage(error),
        variant: "error"
      });
    }
  };
  onMount(() => {
    props.context.ui.dialog.set({
      size: "xlarge",
      centered: true
    });
    props.context.renderer.on("resize", onResize);
  });
  onCleanup(() => {
    props.context.renderer.off("resize", onResize);
  });
  return (() => {
    var _el$10 = _$createElement("box"), _el$11 = _$createElement("text"), _el$12 = _$createElement("b"), _el$14 = _$createElement("textarea"), _el$15 = _$createElement("box"), _el$16 = _$createElement("text"), _el$17 = _$createElement("text"), _el$19 = _$createElement("text");
    _$insertNode(_el$10, _el$11);
    _$insertNode(_el$10, _el$14);
    _$insertNode(_el$10, _el$15);
    _$setProp(_el$10, "padding", 1);
    _$setProp(_el$10, "gap", 1);
    _$insertNode(_el$11, _el$12);
    _$setProp(_el$11, "wrapMode", "none");
    _$setProp(_el$11, "truncate", true);
    _$setProp(_el$11, "height", 1);
    _$insertNode(_el$12, _$createTextNode(`Content`));
    _$use((value) => {
      editor = value;
    }, _el$14);
    _$setProp(_el$14, "placeholder", "Write memo content\u2026");
    _$setProp(_el$14, "wrapMode", "word");
    _$setProp(_el$14, "keyBindings", [{
      name: "return",
      action: "submit"
    }, {
      name: "kpenter",
      action: "submit"
    }, {
      name: "linefeed",
      action: "submit"
    }, {
      name: "return",
      ctrl: true,
      action: "newline"
    }, {
      name: "kpenter",
      ctrl: true,
      action: "newline"
    }, {
      name: "linefeed",
      ctrl: true,
      action: "newline"
    }]);
    _$setProp(_el$14, "onSubmit", () => {
      save();
    });
    _$setProp(_el$14, "onMouseDown", focusContent);
    _$setProp(_el$14, "onContentChange", contentChanged);
    _$insertNode(_el$15, _el$16);
    _$insertNode(_el$15, _el$17);
    _$insertNode(_el$15, _el$19);
    _$setProp(_el$15, "flexDirection", "row");
    _$setProp(_el$15, "gap", 2);
    _$setProp(_el$16, "height", 1);
    _$setProp(_el$16, "wrapMode", "none");
    _$setProp(_el$16, "onMouseUp", (event) => click(event, () => {
      save();
    }));
    _$insert(_el$16, () => saving() ? "Saving\u2026" : "Save");
    _$insertNode(_el$17, _$createTextNode(`Cancel`));
    _$setProp(_el$17, "height", 1);
    _$setProp(_el$17, "wrapMode", "none");
    _$setProp(_el$17, "onMouseUp", (event) => click(event, props.onCancel));
    _$insertNode(_el$19, _$createTextNode(`Enter save \xB7 Ctrl+Enter newline \xB7 Esc cancel`));
    _$setProp(_el$19, "height", 1);
    _$setProp(_el$19, "wrapMode", "none");
    _$setProp(_el$19, "truncate", true);
    _$effect((_p$) => {
      var _v$7 = props.context.theme.text.base, _v$8 = props.initialContent, _v$9 = Math.max(5, terminalHeight() - 8), _v$0 = props.context.theme.text.action.primary.base, _v$1 = props.context.theme.text.muted, _v$10 = props.context.theme.text.muted;
      _v$7 !== _p$.e && (_p$.e = _$setProp(_el$11, "fg", _v$7, _p$.e));
      _v$8 !== _p$.t && (_p$.t = _$setProp(_el$14, "initialValue", _v$8, _p$.t));
      _v$9 !== _p$.a && (_p$.a = _$setProp(_el$14, "height", _v$9, _p$.a));
      _v$0 !== _p$.o && (_p$.o = _$setProp(_el$16, "fg", _v$0, _p$.o));
      _v$1 !== _p$.i && (_p$.i = _$setProp(_el$17, "fg", _v$1, _p$.i));
      _v$10 !== _p$.n && (_p$.n = _$setProp(_el$19, "fg", _v$10, _p$.n));
      return _p$;
    }, {
      e: undefined,
      t: undefined,
      a: undefined,
      o: undefined,
      i: undefined,
      n: undefined
    });
    return _el$10;
  })();
}
function openMemoEditor(context, options) {
  const cancel = () => {
    if (options.onCancel)
      options.onCancel();
    else
      context.ui.dialog.clear();
  };
  const showContentEditor = (title) => {
    context.ui.dialog.show(() => _$createComponent(MemoContentEditor, {
      context,
      get initialContent() {
        return options.initialContent;
      },
      onSave: async (content) => {
        await options.onSave(title, content);
      },
      onCancel: cancel
    }));
  };
  const editInDefaultEditor = async (title, command) => {
    context.ui.dialog.clear();
    const result = await editInEditor(context, command, options.initialContent);
    if (result.status === "saved") {
      try {
        await options.onSave(title, result.content);
      } catch (error) {
        context.ui.toast.show({
          title: "Memos",
          message: errorMessage(error),
          variant: "error"
        });
      }
      return;
    }
    if (result.status === "failed") {
      context.ui.toast.show({
        title: "Memos",
        message: result.message,
        variant: "error"
      });
      showContentEditor(title);
      return;
    }
    cancel();
  };
  const startContent = (title) => {
    const command = editorCommand();
    if (command === undefined) {
      showContentEditor(title);
      return;
    }
    editInDefaultEditor(title, command);
  };
  const promptTitle = async () => {
    let current = options.initialTitle;
    for (;; ) {
      const raw = await context.ui.dialog.prompt({
        title: "Memo title",
        placeholder: "Memo title",
        value: current
      });
      if (raw === undefined) {
        cancel();
        return;
      }
      const clean = raw.trim();
      if (clean.length === 0) {
        context.ui.toast.show({
          title: "Memos",
          message: "A memo title is required",
          variant: "error"
        });
        current = "";
        continue;
      }
      startContent(clean);
      return;
    }
  };
  promptTitle();
}
function MemosPanel(props) {
  const [state, setState] = createSignal({
    groups: [],
    loading: true
  });
  let requestID = 0;
  const refresh = async () => {
    const currentRequest = ++requestID;
    setState((current) => ({
      ...current,
      loading: true,
      error: undefined
    }));
    try {
      const names = await props.repository.listGroups();
      const groups = await Promise.all(names.map(async (name) => {
        try {
          const data = await props.repository.read(name);
          return {
            name,
            memos: data.memos
          };
        } catch (error) {
          return {
            name,
            memos: [],
            error: errorMessage(error)
          };
        }
      }));
      if (currentRequest !== requestID)
        return;
      setState({
        groups,
        loading: false
      });
    } catch (error) {
      if (currentRequest !== requestID)
        return;
      setState((current) => ({
        ...current,
        loading: false,
        error: errorMessage(error)
      }));
    }
  };
  createEffect(() => {
    refresh();
  });
  onCleanup(() => {
    requestID += 1;
  });
  const addMemo = (group) => {
    openMemoEditor(props.context, {
      initialTitle: "",
      initialContent: "",
      onSave: async (title, content) => {
        await props.repository.add(group, title, content);
        await refresh();
      }
    });
  };
  const createGroup = async () => {
    let current = "";
    for (;; ) {
      const raw = await props.context.ui.dialog.prompt({
        title: "Create memo group",
        placeholder: "personal",
        value: current
      });
      if (raw === undefined)
        return;
      const name = raw.trim();
      if (!isValidGroupName(name)) {
        props.context.ui.toast.show({
          title: "Memos",
          message: "Use letters, numbers, _ or -; start with a letter or number",
          variant: "error"
        });
        current = name;
        continue;
      }
      try {
        await props.repository.createGroup(name);
        await refresh();
        return;
      } catch (error) {
        props.context.ui.toast.show({
          title: "Memos",
          message: errorMessage(error),
          variant: "error"
        });
        return;
      }
    }
  };
  const manageGroup = async (group) => {
    const action = await props.context.ui.dialog.select({
      title: `${group} group`,
      options: [{
        title: "Delete group",
        value: "delete",
        description: "Only if it has no memos or other files"
      }]
    });
    if (action !== "delete")
      return;
    try {
      const data = await props.repository.read(group);
      if (data.memos.length > 0) {
        await props.context.ui.dialog.alert({
          title: "Group is not empty",
          message: "Delete all memos, including hidden ones, first."
        });
        return;
      }
      const confirmed = await props.context.ui.dialog.confirm({
        title: `Delete ${group} group?`,
        message: "Only an empty group can be deleted. Other files in its directory will not be removed.",
        label: {
          confirm: "Delete",
          cancel: "Cancel"
        }
      }) ?? false;
      if (!confirmed)
        return;
      await props.repository.deleteGroup(group);
      await refresh();
    } catch (error) {
      props.context.ui.toast.show({
        title: "Memos",
        message: errorMessage(error),
        variant: "error"
      });
    }
  };
  const toggleChecked = async (group, memo) => {
    try {
      await props.repository.setChecked(group, memo.id, !memo.checked);
      await refresh();
    } catch (error) {
      props.context.ui.toast.show({
        title: "Memos",
        message: errorMessage(error),
        variant: "error"
      });
    }
  };
  const changeDeleted = async (group, memo, deleted) => {
    try {
      const confirmed = await props.context.ui.dialog.confirm({
        title: deleted ? "Hide this memo?" : "Restore this memo?",
        message: deleted ? "It will be hidden from the active memo list." : "It will reappear in the active memo list.",
        label: {
          confirm: deleted ? "Hide" : "Restore",
          cancel: "Cancel"
        }
      }) ?? false;
      if (!confirmed)
        return;
      await props.repository.setDeleted(group, memo.id, deleted);
      await refresh();
    } catch (error) {
      props.context.ui.toast.show({
        title: "Memos",
        message: errorMessage(error),
        variant: "error"
      });
    }
  };
  const deleteMemoPermanently = async (group, memo) => {
    try {
      const confirmed = await props.context.ui.dialog.confirm({
        title: "Delete this memo?",
        message: "This permanently removes the memo and cannot be undone.",
        label: {
          confirm: "Delete",
          cancel: "Cancel"
        }
      }) ?? false;
      if (!confirmed)
        return;
      await props.repository.deleteMemo(group, memo.id);
      await refresh();
    } catch (error) {
      props.context.ui.toast.show({
        title: "Memos",
        message: errorMessage(error),
        variant: "error"
      });
    }
  };
  const openMemo = (group, memo) => {
    props.context.ui.dialog.show(() => _$createComponent(MemoDetail, {
      get context() {
        return props.context;
      },
      get repository() {
        return props.repository;
      },
      group,
      memo,
      onChanged: () => refresh()
    }));
  };
  const visibleMemos = (group) => group.memos.filter((memo) => props.preferences.showDeleted || !memo.deleted);
  return (() => {
    var _el$21 = _$createElement("box"), _el$22 = _$createElement("box"), _el$23 = _$createElement("text"), _el$24 = _$createElement("b"), _el$25 = _$createTextNode(` Memos`);
    _$insertNode(_el$21, _el$22);
    _$insertNode(_el$22, _el$23);
    _$setProp(_el$22, "flexDirection", "row");
    _$setProp(_el$22, "gap", 2);
    _$insertNode(_el$23, _el$24);
    _$setProp(_el$23, "wrapMode", "none");
    _$setProp(_el$23, "truncate", true);
    _$setProp(_el$23, "height", 1);
    _$setProp(_el$23, "onMouseDown", (event) => click(event, () => props.updatePreferences((draft) => {
      draft.collapsed = !draft.collapsed;
    })));
    _$insertNode(_el$24, _el$25);
    _$insert(_el$24, () => props.preferences.collapsed ? "\u25B6" : "\u25BC", _el$25);
    _$insert(_el$22, _$createComponent(Show, {
      get when() {
        return !props.preferences.collapsed;
      },
      get children() {
        var _el$26 = _$createElement("text");
        _$insertNode(_el$26, _$createTextNode(`+ Group`));
        _$setProp(_el$26, "height", 1);
        _$setProp(_el$26, "wrapMode", "none");
        _$setProp(_el$26, "onMouseUp", (event) => click(event, () => {
          createGroup();
        }));
        _$effect((_$p) => _$setProp(_el$26, "fg", props.context.theme.hue.accent[400], _$p));
        return _el$26;
      }
    }), null);
    _$insert(_el$21, _$createComponent(Show, {
      get when() {
        return !props.preferences.collapsed;
      },
      get children() {
        return [_$createComponent(Show, {
          get when() {
            return state().loading;
          },
          get children() {
            var _el$28 = _$createElement("text");
            _$insertNode(_el$28, _$createTextNode(`Loading memos\u2026`));
            _$effect((_$p) => _$setProp(_el$28, "fg", props.context.theme.text.muted, _$p));
            return _el$28;
          }
        }), _$createComponent(Show, {
          get when() {
            return state().error;
          },
          get children() {
            var _el$30 = _$createElement("text");
            _$setProp(_el$30, "maxHeight", 2);
            _$insert(_el$30, () => state().error);
            _$effect((_$p) => _$setProp(_el$30, "fg", props.context.theme.text.feedback.error.base, _$p));
            return _el$30;
          }
        }), _$createComponent(Show, {
          get when() {
            return _$memo(() => !!(!state().loading && !state().error))() && state().groups.length === 0;
          },
          get children() {
            return [(() => {
              var _el$31 = _$createElement("text");
              _$insertNode(_el$31, _$createTextNode(`No memo groups yet.`));
              _$effect((_$p) => _$setProp(_el$31, "fg", props.context.theme.text.muted, _$p));
              return _el$31;
            })(), (() => {
              var _el$33 = _$createElement("text");
              _$insertNode(_el$33, _$createTextNode(`+ Create group`));
              _$setProp(_el$33, "height", 1);
              _$setProp(_el$33, "wrapMode", "none");
              _$setProp(_el$33, "onMouseUp", (event) => click(event, () => {
                createGroup();
              }));
              _$effect((_$p) => _$setProp(_el$33, "fg", props.context.theme.hue.accent[400], _$p));
              return _el$33;
            })()];
          }
        }), _$createComponent(For, {
          get each() {
            return state().groups;
          },
          children: (group) => (() => {
            var _el$39 = _$createElement("box"), _el$40 = _$createElement("box"), _el$41 = _$createElement("text"), _el$42 = _$createElement("b"), _el$43 = _$createElement("text"), _el$45 = _$createElement("text");
            _$insertNode(_el$39, _el$40);
            _$insertNode(_el$40, _el$41);
            _$insertNode(_el$40, _el$43);
            _$insertNode(_el$40, _el$45);
            _$setProp(_el$40, "flexDirection", "row");
            _$setProp(_el$40, "gap", 2);
            _$insertNode(_el$41, _el$42);
            _$setProp(_el$41, "wrapMode", "none");
            _$setProp(_el$41, "truncate", true);
            _$setProp(_el$41, "height", 1);
            _$insert(_el$42, () => group.name);
            _$insertNode(_el$43, _$createTextNode(`+ New`));
            _$setProp(_el$43, "height", 1);
            _$setProp(_el$43, "wrapMode", "none");
            _$setProp(_el$43, "onMouseUp", (event) => click(event, () => {
              addMemo(group.name);
            }));
            _$insertNode(_el$45, _$createTextNode(`\u22EF`));
            _$setProp(_el$45, "height", 1);
            _$setProp(_el$45, "wrapMode", "none");
            _$setProp(_el$45, "onMouseUp", (event) => click(event, () => {
              manageGroup(group.name);
            }));
            _$insert(_el$39, _$createComponent(Show, {
              get when() {
                return group.error;
              },
              get children() {
                var _el$47 = _$createElement("text");
                _$setProp(_el$47, "maxHeight", 2);
                _$insert(_el$47, () => group.error);
                _$effect((_$p) => _$setProp(_el$47, "fg", props.context.theme.text.feedback.error.base, _$p));
                return _el$47;
              }
            }), null);
            _$insert(_el$39, _$createComponent(Show, {
              get when() {
                return _$memo(() => !!!group.error)() && visibleMemos(group).length === 0;
              },
              get children() {
                var _el$48 = _$createElement("text");
                _$insert(_el$48, () => props.preferences.showDeleted ? "No memos." : "No active memos.");
                _$effect((_$p) => _$setProp(_el$48, "fg", props.context.theme.text.muted, _$p));
                return _el$48;
              }
            }), null);
            _$insert(_el$39, _$createComponent(For, {
              get each() {
                return visibleMemos(group);
              },
              children: (memo) => (() => {
                var _el$49 = _$createElement("box"), _el$50 = _$createElement("text"), _el$51 = _$createElement("text"), _el$52 = _$createElement("text");
                _$insertNode(_el$49, _el$50);
                _$insertNode(_el$49, _el$51);
                _$insertNode(_el$49, _el$52);
                _$setProp(_el$49, "flexDirection", "row");
                _$setProp(_el$49, "gap", 1);
                _$setProp(_el$50, "wrapMode", "none");
                _$setProp(_el$50, "height", 1);
                _$setProp(_el$50, "onMouseUp", (event) => click(event, () => {
                  memo.deleted ? changeDeleted(group.name, memo, false) : toggleChecked(group.name, memo);
                }));
                _$insert(_el$50, (() => {
                  var _c$ = _$memo(() => !!memo.deleted);
                  return () => _c$() ? "\u21B6" : memo.checked ? "\u2713" : "\u25CB";
                })());
                _$setProp(_el$51, "wrapMode", "none");
                _$setProp(_el$51, "truncate", true);
                _$setProp(_el$51, "height", 1);
                _$setProp(_el$51, "onMouseUp", (event) => click(event, () => openMemo(group.name, memo)));
                _$insert(_el$51, () => memo.title);
                _$setProp(_el$52, "wrapMode", "none");
                _$setProp(_el$52, "height", 1);
                _$setProp(_el$52, "paddingX", 1);
                _$setProp(_el$52, "onMouseUp", (event) => click(event, () => {
                  memo.deleted ? deleteMemoPermanently(group.name, memo) : changeDeleted(group.name, memo, true);
                }));
                _$insert(_el$52, () => memo.deleted ? "\uD83D\uDDD1" : "\xD7");
                _$effect((_p$) => {
                  var _v$14 = memo.deleted ? props.context.theme.text.feedback.warning.base : memo.checked ? props.context.theme.text.feedback.success.base : props.context.theme.text.muted, _v$15 = memo.deleted ? props.context.theme.text.muted : props.context.theme.text.base, _v$16 = memo.deleted ? props.context.theme.text.feedback.error.base : props.context.theme.text.feedback.error.muted;
                  _v$14 !== _p$.e && (_p$.e = _$setProp(_el$50, "fg", _v$14, _p$.e));
                  _v$15 !== _p$.t && (_p$.t = _$setProp(_el$51, "fg", _v$15, _p$.t));
                  _v$16 !== _p$.a && (_p$.a = _$setProp(_el$52, "fg", _v$16, _p$.a));
                  return _p$;
                }, {
                  e: undefined,
                  t: undefined,
                  a: undefined
                });
                return _el$49;
              })()
            }), null);
            _$effect((_p$) => {
              var _v$11 = props.context.theme.hue.accent[400], _v$12 = props.context.theme.hue.accent[400], _v$13 = props.context.theme.text.muted;
              _v$11 !== _p$.e && (_p$.e = _$setProp(_el$41, "fg", _v$11, _p$.e));
              _v$12 !== _p$.t && (_p$.t = _$setProp(_el$43, "fg", _v$12, _p$.t));
              _v$13 !== _p$.a && (_p$.a = _$setProp(_el$45, "fg", _v$13, _p$.a));
              return _p$;
            }, {
              e: undefined,
              t: undefined,
              a: undefined
            });
            return _el$39;
          })()
        }), (() => {
          var _el$35 = _$createElement("box"), _el$37 = _$createElement("text");
          _$insertNode(_el$35, _el$37);
          _$setProp(_el$35, "flexDirection", "row");
          _$setProp(_el$35, "gap", 2);
          _$insert(_el$35, _$createComponent(Show, {
            get when() {
              return state().groups.length > 0;
            },
            get children() {
              var _el$36 = _$createElement("text");
              _$setProp(_el$36, "height", 1);
              _$setProp(_el$36, "wrapMode", "none");
              _$setProp(_el$36, "onMouseUp", (event) => click(event, () => props.updatePreferences((draft) => {
                draft.showDeleted = !draft.showDeleted;
              })));
              _$insert(_el$36, () => props.preferences.showDeleted ? "Hide deleted" : "Show deleted");
              _$effect((_$p) => _$setProp(_el$36, "fg", props.context.theme.text.muted, _$p));
              return _el$36;
            }
          }), _el$37);
          _$insertNode(_el$37, _$createTextNode(`\u21BB Refresh`));
          _$setProp(_el$37, "height", 1);
          _$setProp(_el$37, "wrapMode", "none");
          _$setProp(_el$37, "onMouseUp", (event) => click(event, () => {
            refresh();
          }));
          _$effect((_$p) => _$setProp(_el$37, "fg", props.context.theme.text.muted, _$p));
          return _el$35;
        })()];
      }
    }), null);
    _$effect((_$p) => _$setProp(_el$23, "fg", props.context.theme.text.base, _$p));
    return _el$21;
  })();
}
var tui_default = Plugin.define({
  id: "opencode-memos",
  setup(context) {
    const [preferences, updatePreferences] = context.storage.memory("panel", {
      initial: {
        collapsed: false,
        showDeleted: false
      }
    });
    const repository = new MemoRepository;
    return context.ui.slot({
      prepend: "sidebar.content",
      render: () => _$createComponent(MemosPanel, {
        context,
        repository,
        preferences,
        updatePreferences
      })
    });
  }
});
export {
  tui_default as default
};
