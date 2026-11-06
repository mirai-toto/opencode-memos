// @bun
// src/tui.tsx
import { effect as _$effect } from "@opentui/solid";
import { use as _$use } from "@opentui/solid";
import { createTextNode as _$createTextNode } from "@opentui/solid";
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
import { mkdir, readdir, readFile, rename, rm, writeFile } from "fs/promises";
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
        return ["personal"];
      throw error;
    }
    const groups = entries.filter((entry) => entry.isDirectory() && isValidGroup(entry.name)).map((entry) => entry.name).sort((left, right) => left.localeCompare(right));
    return groups.length > 0 ? groups : ["personal"];
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
    if (!isValidGroup(group))
      throw new Error(`Invalid memo group name: ${group}`);
    return join(this.rootDirectory, group);
  }
}
function isValidGroup(group) {
  return /^[a-zA-Z0-9][a-zA-Z0-9_-]*$/.test(group);
}
function errorCode(error) {
  if (typeof error !== "object" || error === null || !("code" in error))
    return;
  const code = error.code;
  return typeof code === "string" ? code : undefined;
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
    props.context.ui.dialog.show(() => _$createComponent(MemoEditor, {
      get context() {
        return props.context;
      },
      get initialTitle() {
        return props.memo.title;
      },
      get initialContent() {
        return props.memo.content;
      },
      onCancel: showDetail,
      onSave: async (title, content) => {
        await props.repository.updateMemo(props.group, props.memo.id, title, content);
        await props.onChanged();
      }
    }));
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
    var _el$ = _$createElement("box"), _el$2 = _$createElement("text"), _el$3 = _$createElement("b"), _el$4 = _$createTextNode(` `), _el$5 = _$createElement("scrollbox"), _el$6 = _$createElement("text"), _el$7 = _$createElement("text"), _el$8 = _$createTextNode(`\u2191\u2193/PgUp/PgDn scroll \xB7 e edit \xB7 x check/uncheck \xB7 `), _el$9 = _$createTextNode(` \xB7 Esc close`);
    _$insertNode(_el$, _el$2);
    _$insertNode(_el$, _el$5);
    _$insertNode(_el$, _el$7);
    _$setProp(_el$, "padding", 1);
    _$setProp(_el$, "gap", 1);
    _$insertNode(_el$2, _el$3);
    _$setProp(_el$2, "wrapMode", "none");
    _$setProp(_el$2, "truncate", true);
    _$setProp(_el$2, "height", 1);
    _$insertNode(_el$3, _el$4);
    _$insert(_el$3, () => props.memo.checked ? "\u2713" : "\u25CB", _el$4);
    _$insert(_el$3, () => props.memo.title, null);
    _$insertNode(_el$5, _el$6);
    _$use((value) => {
      scroll = value;
    }, _el$5);
    _$setProp(_el$5, "focused", true);
    _$setProp(_el$5, "scrollY", true);
    _$setProp(_el$5, "scrollX", true);
    _$setProp(_el$6, "wrapMode", "none");
    _$setProp(_el$6, "flexShrink", 0);
    _$setProp(_el$6, "height", contentHeight);
    _$insert(_el$6, content);
    _$insertNode(_el$7, _el$8);
    _$insertNode(_el$7, _el$9);
    _$setProp(_el$7, "wrapMode", "none");
    _$setProp(_el$7, "truncate", true);
    _$insert(_el$7, () => props.memo.deleted ? "r restore" : "d hide", _el$9);
    _$effect((_p$) => {
      var _v$ = props.context.theme.text.base, _v$2 = Math.max(3, terminalHeight() - 10), _v$3 = props.context.theme.text.base, _v$4 = props.context.theme.text.muted;
      _v$ !== _p$.e && (_p$.e = _$setProp(_el$2, "fg", _v$, _p$.e));
      _v$2 !== _p$.t && (_p$.t = _$setProp(_el$5, "height", _v$2, _p$.t));
      _v$3 !== _p$.a && (_p$.a = _$setProp(_el$6, "fg", _v$3, _p$.a));
      _v$4 !== _p$.o && (_p$.o = _$setProp(_el$7, "fg", _v$4, _p$.o));
      return _p$;
    }, {
      e: undefined,
      t: undefined,
      a: undefined,
      o: undefined
    });
    return _el$;
  })();
}
function MemoEditor(props) {
  const [terminalHeight, setTerminalHeight] = createSignal(props.context.renderer.terminalHeight);
  const [title, setTitle] = createSignal(props.initialTitle);
  const [content, setContent] = createSignal(props.initialContent);
  const [saving, setSaving] = createSignal(false);
  let titleInput;
  let editor;
  const onResize = () => {
    setTerminalHeight(props.context.renderer.terminalHeight);
  };
  const titleChanged = (value) => {
    setTitle(value);
  };
  const focusTitle = (event) => {
    if (event.button === 0)
      titleInput?.focus();
  };
  const focusContent = (event) => {
    if (event.button === 0)
      editor?.focus();
  };
  const contentChanged = (value) => {
    setContent(typeof value === "string" ? value : editor?.plainText ?? content());
  };
  const cancel = () => {
    if (saving())
      return;
    if (props.onCancel)
      props.onCancel();
    else
      props.context.ui.dialog.clear();
  };
  const save = async () => {
    if (saving())
      return;
    const cleanTitle = title().trim();
    if (cleanTitle.length === 0) {
      props.context.ui.toast.show({
        title: "Memos",
        message: "A memo title is required",
        variant: "error"
      });
      return;
    }
    setSaving(true);
    try {
      await props.onSave(cleanTitle, content());
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
  props.context.keymap.layer(() => ({
    target: () => titleInput,
    commands: [{
      bind: "tab",
      run: () => {
        editor?.focus();
      }
    }]
  }));
  props.context.keymap.layer(() => ({
    target: () => editor,
    commands: [{
      bind: "shift+tab",
      run: () => {
        titleInput?.focus();
      }
    }]
  }));
  onMount(() => {
    props.context.ui.dialog.set({
      size: "xlarge",
      centered: true
    });
    props.context.renderer.on("resize", onResize);
    titleInput?.focus();
  });
  onCleanup(() => {
    props.context.renderer.off("resize", onResize);
  });
  return (() => {
    var _el$0 = _$createElement("box"), _el$1 = _$createElement("text"), _el$10 = _$createElement("b"), _el$12 = _$createElement("input"), _el$13 = _$createElement("text"), _el$14 = _$createElement("b"), _el$16 = _$createElement("textarea"), _el$17 = _$createElement("box"), _el$18 = _$createElement("text"), _el$19 = _$createElement("text"), _el$21 = _$createElement("text");
    _$insertNode(_el$0, _el$1);
    _$insertNode(_el$0, _el$12);
    _$insertNode(_el$0, _el$13);
    _$insertNode(_el$0, _el$16);
    _$insertNode(_el$0, _el$17);
    _$setProp(_el$0, "padding", 1);
    _$setProp(_el$0, "gap", 1);
    _$insertNode(_el$1, _el$10);
    _$setProp(_el$1, "wrapMode", "none");
    _$setProp(_el$1, "truncate", true);
    _$setProp(_el$1, "height", 1);
    _$insertNode(_el$10, _$createTextNode(`Title`));
    _$use((value) => {
      titleInput = value;
    }, _el$12);
    _$setProp(_el$12, "placeholder", "Memo title");
    _$setProp(_el$12, "onMouseDown", focusTitle);
    _$setProp(_el$12, "onInput", titleChanged);
    _$setProp(_el$12, "onSubmit", () => {
      editor?.focus();
    });
    _$insertNode(_el$13, _el$14);
    _$setProp(_el$13, "wrapMode", "none");
    _$setProp(_el$13, "truncate", true);
    _$setProp(_el$13, "height", 1);
    _$insertNode(_el$14, _$createTextNode(`Content`));
    _$use((value) => {
      editor = value;
    }, _el$16);
    _$setProp(_el$16, "placeholder", "Write memo content\u2026");
    _$setProp(_el$16, "wrapMode", "word");
    _$setProp(_el$16, "keyBindings", [{
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
    _$setProp(_el$16, "onSubmit", () => {
      save();
    });
    _$setProp(_el$16, "onMouseDown", focusContent);
    _$setProp(_el$16, "onContentChange", contentChanged);
    _$insertNode(_el$17, _el$18);
    _$insertNode(_el$17, _el$19);
    _$insertNode(_el$17, _el$21);
    _$setProp(_el$17, "flexDirection", "row");
    _$setProp(_el$17, "gap", 2);
    _$setProp(_el$18, "height", 1);
    _$setProp(_el$18, "wrapMode", "none");
    _$setProp(_el$18, "onMouseUp", (event) => click(event, () => {
      save();
    }));
    _$insert(_el$18, () => saving() ? "Saving\u2026" : "Save");
    _$insertNode(_el$19, _$createTextNode(`Cancel`));
    _$setProp(_el$19, "height", 1);
    _$setProp(_el$19, "wrapMode", "none");
    _$setProp(_el$19, "onMouseUp", (event) => click(event, cancel));
    _$insertNode(_el$21, _$createTextNode(`Title Tab/Enter \u2192 content \xB7 Shift+Tab \u2192 title \xB7 Content Enter save \xB7 Ctrl+Enter newline \xB7 Esc cancel`));
    _$setProp(_el$21, "height", 1);
    _$setProp(_el$21, "wrapMode", "none");
    _$setProp(_el$21, "truncate", true);
    _$effect((_p$) => {
      var _v$5 = props.context.theme.text.base, _v$6 = title(), _v$7 = props.context.theme.text.base, _v$8 = props.initialContent, _v$9 = Math.max(5, terminalHeight() - 12), _v$0 = props.context.theme.text.base, _v$1 = props.context.theme.text.muted, _v$10 = props.context.theme.text.muted;
      _v$5 !== _p$.e && (_p$.e = _$setProp(_el$1, "fg", _v$5, _p$.e));
      _v$6 !== _p$.t && (_p$.t = _$setProp(_el$12, "value", _v$6, _p$.t));
      _v$7 !== _p$.a && (_p$.a = _$setProp(_el$13, "fg", _v$7, _p$.a));
      _v$8 !== _p$.o && (_p$.o = _$setProp(_el$16, "initialValue", _v$8, _p$.o));
      _v$9 !== _p$.i && (_p$.i = _$setProp(_el$16, "height", _v$9, _p$.i));
      _v$0 !== _p$.n && (_p$.n = _$setProp(_el$18, "fg", _v$0, _p$.n));
      _v$1 !== _p$.s && (_p$.s = _$setProp(_el$19, "fg", _v$1, _p$.s));
      _v$10 !== _p$.h && (_p$.h = _$setProp(_el$21, "fg", _v$10, _p$.h));
      return _p$;
    }, {
      e: undefined,
      t: undefined,
      a: undefined,
      o: undefined,
      i: undefined,
      n: undefined,
      s: undefined,
      h: undefined
    });
    return _el$0;
  })();
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
    props.context.ui.dialog.show(() => _$createComponent(MemoEditor, {
      get context() {
        return props.context;
      },
      initialTitle: "",
      initialContent: "",
      onSave: async (title, content) => {
        await props.repository.add(group, title, content);
        await refresh();
      }
    }));
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
    var _el$23 = _$createElement("box"), _el$24 = _$createElement("text"), _el$25 = _$createElement("b"), _el$26 = _$createTextNode(` Memos`);
    _$insertNode(_el$23, _el$24);
    _$insertNode(_el$24, _el$25);
    _$setProp(_el$24, "wrapMode", "none");
    _$setProp(_el$24, "truncate", true);
    _$setProp(_el$24, "height", 1);
    _$setProp(_el$24, "onMouseDown", (event) => click(event, () => props.updatePreferences((draft) => {
      draft.collapsed = !draft.collapsed;
    })));
    _$insertNode(_el$25, _el$26);
    _$insert(_el$25, () => props.preferences.collapsed ? "\u25B6" : "\u25BC", _el$26);
    _$insert(_el$23, _$createComponent(Show, {
      get when() {
        return !props.preferences.collapsed;
      },
      get children() {
        return [_$createComponent(Show, {
          get when() {
            return state().loading;
          },
          get children() {
            var _el$27 = _$createElement("text");
            _$insertNode(_el$27, _$createTextNode(`Loading memos\u2026`));
            _$effect((_$p) => _$setProp(_el$27, "fg", props.context.theme.text.muted, _$p));
            return _el$27;
          }
        }), _$createComponent(Show, {
          get when() {
            return state().error;
          },
          get children() {
            var _el$29 = _$createElement("text");
            _$setProp(_el$29, "fg", "#ff7b86");
            _$setProp(_el$29, "maxHeight", 2);
            _$insert(_el$29, () => state().error);
            return _el$29;
          }
        }), _$createComponent(For, {
          get each() {
            return state().groups;
          },
          children: (group) => (() => {
            var _el$34 = _$createElement("box"), _el$35 = _$createElement("box"), _el$36 = _$createElement("text"), _el$37 = _$createElement("b"), _el$38 = _$createElement("text");
            _$insertNode(_el$34, _el$35);
            _$insertNode(_el$35, _el$36);
            _$insertNode(_el$35, _el$38);
            _$setProp(_el$35, "flexDirection", "row");
            _$setProp(_el$35, "gap", 2);
            _$insertNode(_el$36, _el$37);
            _$setProp(_el$36, "wrapMode", "none");
            _$setProp(_el$36, "truncate", true);
            _$setProp(_el$36, "height", 1);
            _$insert(_el$37, () => group.name);
            _$insertNode(_el$38, _$createTextNode(`+ New`));
            _$setProp(_el$38, "height", 1);
            _$setProp(_el$38, "wrapMode", "none");
            _$setProp(_el$38, "onMouseUp", (event) => click(event, () => {
              addMemo(group.name);
            }));
            _$insert(_el$34, _$createComponent(Show, {
              get when() {
                return group.error;
              },
              get children() {
                var _el$40 = _$createElement("text");
                _$setProp(_el$40, "fg", "#ff7b86");
                _$setProp(_el$40, "maxHeight", 2);
                _$insert(_el$40, () => group.error);
                return _el$40;
              }
            }), null);
            _$insert(_el$34, _$createComponent(Show, {
              get when() {
                return _$memo(() => !!!group.error)() && visibleMemos(group).length === 0;
              },
              get children() {
                var _el$41 = _$createElement("text");
                _$insert(_el$41, () => props.preferences.showDeleted ? "No memos." : "No active memos.");
                _$effect((_$p) => _$setProp(_el$41, "fg", props.context.theme.text.muted, _$p));
                return _el$41;
              }
            }), null);
            _$insert(_el$34, _$createComponent(For, {
              get each() {
                return visibleMemos(group);
              },
              children: (memo) => (() => {
                var _el$42 = _$createElement("box"), _el$43 = _$createElement("text"), _el$44 = _$createElement("text");
                _$insertNode(_el$42, _el$43);
                _$insertNode(_el$42, _el$44);
                _$setProp(_el$42, "flexDirection", "row");
                _$setProp(_el$42, "gap", 1);
                _$setProp(_el$43, "wrapMode", "none");
                _$setProp(_el$43, "height", 1);
                _$setProp(_el$43, "onMouseUp", (event) => click(event, () => {
                  memo.deleted ? changeDeleted(group.name, memo, false) : toggleChecked(group.name, memo);
                }));
                _$insert(_el$43, (() => {
                  var _c$ = _$memo(() => !!memo.deleted);
                  return () => _c$() ? "\u21B6" : memo.checked ? "\u2713" : "\u25CB";
                })());
                _$setProp(_el$44, "wrapMode", "none");
                _$setProp(_el$44, "truncate", true);
                _$setProp(_el$44, "height", 1);
                _$setProp(_el$44, "onMouseUp", (event) => click(event, () => openMemo(group.name, memo)));
                _$insert(_el$44, () => memo.title);
                _$insert(_el$42, _$createComponent(Show, {
                  get when() {
                    return !memo.deleted;
                  },
                  get children() {
                    var _el$45 = _$createElement("text");
                    _$insertNode(_el$45, _$createTextNode(`\xD7`));
                    _$setProp(_el$45, "wrapMode", "none");
                    _$setProp(_el$45, "height", 1);
                    _$setProp(_el$45, "onMouseUp", (event) => click(event, () => {
                      changeDeleted(group.name, memo, true);
                    }));
                    _$effect((_$p) => _$setProp(_el$45, "fg", props.context.theme.text.muted, _$p));
                    return _el$45;
                  }
                }), null);
                _$effect((_p$) => {
                  var _v$15 = props.context.theme.text.muted, _v$16 = memo.deleted ? props.context.theme.text.muted : props.context.theme.text.base;
                  _v$15 !== _p$.e && (_p$.e = _$setProp(_el$43, "fg", _v$15, _p$.e));
                  _v$16 !== _p$.t && (_p$.t = _$setProp(_el$44, "fg", _v$16, _p$.t));
                  return _p$;
                }, {
                  e: undefined,
                  t: undefined
                });
                return _el$42;
              })()
            }), null);
            _$effect((_p$) => {
              var _v$13 = props.context.theme.text.base, _v$14 = props.context.theme.text.muted;
              _v$13 !== _p$.e && (_p$.e = _$setProp(_el$36, "fg", _v$13, _p$.e));
              _v$14 !== _p$.t && (_p$.t = _$setProp(_el$38, "fg", _v$14, _p$.t));
              return _p$;
            }, {
              e: undefined,
              t: undefined
            });
            return _el$34;
          })()
        }), (() => {
          var _el$30 = _$createElement("box"), _el$31 = _$createElement("text"), _el$32 = _$createElement("text");
          _$insertNode(_el$30, _el$31);
          _$insertNode(_el$30, _el$32);
          _$setProp(_el$30, "flexDirection", "row");
          _$setProp(_el$30, "gap", 2);
          _$setProp(_el$31, "height", 1);
          _$setProp(_el$31, "wrapMode", "none");
          _$setProp(_el$31, "onMouseUp", (event) => click(event, () => props.updatePreferences((draft) => {
            draft.showDeleted = !draft.showDeleted;
          })));
          _$insert(_el$31, () => props.preferences.showDeleted ? "Hide deleted" : "Show deleted");
          _$insertNode(_el$32, _$createTextNode(`\u21BB Refresh`));
          _$setProp(_el$32, "height", 1);
          _$setProp(_el$32, "wrapMode", "none");
          _$setProp(_el$32, "onMouseUp", (event) => click(event, () => {
            refresh();
          }));
          _$effect((_p$) => {
            var _v$11 = props.context.theme.text.muted, _v$12 = props.context.theme.text.muted;
            _v$11 !== _p$.e && (_p$.e = _$setProp(_el$31, "fg", _v$11, _p$.e));
            _v$12 !== _p$.t && (_p$.t = _$setProp(_el$32, "fg", _v$12, _p$.t));
            return _p$;
          }, {
            e: undefined,
            t: undefined
          });
          return _el$30;
        })()];
      }
    }), null);
    _$effect((_$p) => _$setProp(_el$24, "fg", props.context.theme.text.base, _$p));
    return _el$23;
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
