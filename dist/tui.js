// @bun
// src/tui.tsx
import { createComponent as _$createComponent } from "@opentui/solid";
import { effect as _$effect } from "@opentui/solid";
import { use as _$use } from "@opentui/solid";
import { createTextNode as _$createTextNode } from "@opentui/solid";
import { insertNode as _$insertNode } from "@opentui/solid";
import { insert as _$insert } from "@opentui/solid";
import { memo as _$memo } from "@opentui/solid";
import { setProp as _$setProp } from "@opentui/solid";
import { createElement as _$createElement } from "@opentui/solid";
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
    var _el$ = _$createElement("box"), _el$2 = _$createElement("text"), _el$3 = _$createElement("b"), _el$4 = _$createTextNode(` `), _el$5 = _$createElement("scrollbox"), _el$6 = _$createElement("text"), _el$7 = _$createElement("text"), _el$8 = _$createTextNode(`\u2191\u2193/PgUp/PgDn scroll \xB7 x check/uncheck \xB7 `), _el$9 = _$createTextNode(` \xB7 Esc close`);
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
function MemosPanel(props) {
  const initialGroup = props.preferences.group || "personal";
  const [state, setState] = createSignal({
    groups: [initialGroup],
    group: initialGroup,
    memos: [],
    loading: true
  });
  let requestID = 0;
  const refresh = async (preferredGroup) => {
    const currentRequest = ++requestID;
    setState((current) => ({
      ...current,
      loading: true,
      error: undefined
    }));
    try {
      const groups = await props.repository.listGroups();
      const group = groups.includes(preferredGroup) ? preferredGroup : groups[0] ?? "personal";
      if (group !== props.preferences.group) {
        props.updatePreferences((draft) => {
          draft.group = group;
        });
      }
      const data = await props.repository.read(group);
      if (currentRequest !== requestID)
        return;
      setState({
        groups,
        group,
        memos: data.memos,
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
    refresh(props.preferences.group || "personal");
  });
  onCleanup(() => {
    requestID += 1;
  });
  const chooseGroup = async () => {
    try {
      const options = state().groups.map((group) => ({
        title: group,
        value: group
      }));
      const group = await props.context.ui.dialog.select({
        title: "Memo group",
        options
      });
      if (group)
        props.updatePreferences((draft) => {
          draft.group = group;
        });
    } catch (error) {
      props.context.ui.toast.show({
        title: "Memos",
        message: errorMessage(error),
        variant: "error"
      });
    }
  };
  const addMemo = async () => {
    try {
      const title = await props.context.ui.dialog.prompt({
        title: "New memo title",
        placeholder: "Title"
      });
      if (title === undefined || title.trim().length === 0)
        return;
      const content = await props.context.ui.dialog.prompt({
        title: "New memo content",
        placeholder: "Memo text"
      });
      if (content === undefined)
        return;
      await props.repository.add(state().group, title.trim(), content);
      await refresh(state().group);
    } catch (error) {
      props.context.ui.toast.show({
        title: "Memos",
        message: errorMessage(error),
        variant: "error"
      });
    }
  };
  const toggleChecked = async (memo) => {
    try {
      await props.repository.setChecked(state().group, memo.id, !memo.checked);
      await refresh(state().group);
    } catch (error) {
      props.context.ui.toast.show({
        title: "Memos",
        message: errorMessage(error),
        variant: "error"
      });
    }
  };
  const changeDeleted = async (memo, deleted) => {
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
      await props.repository.setDeleted(state().group, memo.id, deleted);
      await refresh(state().group);
    } catch (error) {
      props.context.ui.toast.show({
        title: "Memos",
        message: errorMessage(error),
        variant: "error"
      });
    }
  };
  const openMemo = (memo) => {
    props.context.ui.dialog.show(() => _$createComponent(MemoDetail, {
      get context() {
        return props.context;
      },
      get repository() {
        return props.repository;
      },
      get group() {
        return state().group;
      },
      memo,
      onChanged: () => refresh(state().group)
    }));
  };
  const visibleMemos = () => state().memos.filter((memo) => props.preferences.showDeleted || !memo.deleted);
  return (() => {
    var _el$0 = _$createElement("box"), _el$1 = _$createElement("text"), _el$10 = _$createElement("b"), _el$11 = _$createTextNode(` Memos`);
    _$insertNode(_el$0, _el$1);
    _$insertNode(_el$1, _el$10);
    _$setProp(_el$1, "wrapMode", "none");
    _$setProp(_el$1, "truncate", true);
    _$setProp(_el$1, "height", 1);
    _$setProp(_el$1, "onMouseDown", (event) => click(event, () => props.updatePreferences((draft) => {
      draft.collapsed = !draft.collapsed;
    })));
    _$insertNode(_el$10, _el$11);
    _$insert(_el$10, () => props.preferences.collapsed ? "\u25B6" : "\u25BC", _el$11);
    _$insert(_el$0, _$createComponent(Show, {
      get when() {
        return !props.preferences.collapsed;
      },
      get children() {
        return [(() => {
          var _el$12 = _$createElement("box"), _el$13 = _$createElement("text"), _el$14 = _$createTextNode(`Group: `), _el$15 = _$createTextNode(` \u25BE`), _el$16 = _$createElement("text");
          _$insertNode(_el$12, _el$13);
          _$insertNode(_el$12, _el$16);
          _$setProp(_el$12, "flexDirection", "row");
          _$setProp(_el$12, "gap", 2);
          _$insertNode(_el$13, _el$14);
          _$insertNode(_el$13, _el$15);
          _$setProp(_el$13, "wrapMode", "none");
          _$setProp(_el$13, "truncate", true);
          _$setProp(_el$13, "height", 1);
          _$setProp(_el$13, "onMouseUp", (event) => click(event, () => {
            chooseGroup();
          }));
          _$insert(_el$13, () => state().group, _el$15);
          _$insertNode(_el$16, _$createTextNode(`+ New`));
          _$setProp(_el$16, "height", 1);
          _$setProp(_el$16, "wrapMode", "none");
          _$setProp(_el$16, "onMouseUp", (event) => click(event, () => {
            addMemo();
          }));
          _$effect((_p$) => {
            var _v$5 = props.context.theme.text.muted, _v$6 = props.context.theme.text.muted;
            _v$5 !== _p$.e && (_p$.e = _$setProp(_el$13, "fg", _v$5, _p$.e));
            _v$6 !== _p$.t && (_p$.t = _$setProp(_el$16, "fg", _v$6, _p$.t));
            return _p$;
          }, {
            e: undefined,
            t: undefined
          });
          return _el$12;
        })(), _$createComponent(Show, {
          get when() {
            return state().loading;
          },
          get children() {
            var _el$18 = _$createElement("text");
            _$insertNode(_el$18, _$createTextNode(`Loading memos\u2026`));
            _$effect((_$p) => _$setProp(_el$18, "fg", props.context.theme.text.muted, _$p));
            return _el$18;
          }
        }), _$createComponent(Show, {
          get when() {
            return state().error;
          },
          get children() {
            var _el$20 = _$createElement("text");
            _$setProp(_el$20, "fg", "#ff7b86");
            _$setProp(_el$20, "maxHeight", 2);
            _$insert(_el$20, () => state().error);
            return _el$20;
          }
        }), _$createComponent(Show, {
          get when() {
            return _$memo(() => !!(!state().loading && !state().error))() && visibleMemos().length === 0;
          },
          get children() {
            var _el$21 = _$createElement("text");
            _$insertNode(_el$21, _$createTextNode(`No memos in this group.`));
            _$effect((_$p) => _$setProp(_el$21, "fg", props.context.theme.text.muted, _$p));
            return _el$21;
          }
        }), _$createComponent(For, {
          get each() {
            return visibleMemos();
          },
          children: (memo) => (() => {
            var _el$27 = _$createElement("box"), _el$28 = _$createElement("text"), _el$29 = _$createElement("text");
            _$insertNode(_el$27, _el$28);
            _$insertNode(_el$27, _el$29);
            _$setProp(_el$27, "flexDirection", "row");
            _$setProp(_el$27, "gap", 1);
            _$setProp(_el$28, "wrapMode", "none");
            _$setProp(_el$28, "height", 1);
            _$setProp(_el$28, "onMouseUp", (event) => click(event, () => {
              memo.deleted ? changeDeleted(memo, false) : toggleChecked(memo);
            }));
            _$insert(_el$28, (() => {
              var _c$ = _$memo(() => !!memo.deleted);
              return () => _c$() ? "\u21B6" : memo.checked ? "\u2713" : "\u25CB";
            })());
            _$setProp(_el$29, "wrapMode", "none");
            _$setProp(_el$29, "truncate", true);
            _$setProp(_el$29, "height", 1);
            _$setProp(_el$29, "onMouseUp", (event) => click(event, () => openMemo(memo)));
            _$insert(_el$29, () => memo.title);
            _$insert(_el$27, _$createComponent(Show, {
              get when() {
                return !memo.deleted;
              },
              get children() {
                var _el$30 = _$createElement("text");
                _$insertNode(_el$30, _$createTextNode(`\xD7`));
                _$setProp(_el$30, "wrapMode", "none");
                _$setProp(_el$30, "height", 1);
                _$setProp(_el$30, "onMouseUp", (event) => click(event, () => {
                  changeDeleted(memo, true);
                }));
                _$effect((_$p) => _$setProp(_el$30, "fg", props.context.theme.text.muted, _$p));
                return _el$30;
              }
            }), null);
            _$effect((_p$) => {
              var _v$9 = props.context.theme.text.muted, _v$0 = memo.deleted ? props.context.theme.text.muted : props.context.theme.text.base;
              _v$9 !== _p$.e && (_p$.e = _$setProp(_el$28, "fg", _v$9, _p$.e));
              _v$0 !== _p$.t && (_p$.t = _$setProp(_el$29, "fg", _v$0, _p$.t));
              return _p$;
            }, {
              e: undefined,
              t: undefined
            });
            return _el$27;
          })()
        }), (() => {
          var _el$23 = _$createElement("box"), _el$24 = _$createElement("text"), _el$25 = _$createElement("text");
          _$insertNode(_el$23, _el$24);
          _$insertNode(_el$23, _el$25);
          _$setProp(_el$23, "flexDirection", "row");
          _$setProp(_el$23, "gap", 2);
          _$setProp(_el$24, "height", 1);
          _$setProp(_el$24, "wrapMode", "none");
          _$setProp(_el$24, "onMouseUp", (event) => click(event, () => props.updatePreferences((draft) => {
            draft.showDeleted = !draft.showDeleted;
          })));
          _$insert(_el$24, () => props.preferences.showDeleted ? "Hide deleted" : "Show deleted");
          _$insertNode(_el$25, _$createTextNode(`\u21BB Refresh`));
          _$setProp(_el$25, "height", 1);
          _$setProp(_el$25, "wrapMode", "none");
          _$setProp(_el$25, "onMouseUp", (event) => click(event, () => {
            refresh(state().group);
          }));
          _$effect((_p$) => {
            var _v$7 = props.context.theme.text.muted, _v$8 = props.context.theme.text.muted;
            _v$7 !== _p$.e && (_p$.e = _$setProp(_el$24, "fg", _v$7, _p$.e));
            _v$8 !== _p$.t && (_p$.t = _$setProp(_el$25, "fg", _v$8, _p$.t));
            return _p$;
          }, {
            e: undefined,
            t: undefined
          });
          return _el$23;
        })()];
      }
    }), null);
    _$effect((_$p) => _$setProp(_el$1, "fg", props.context.theme.text.base, _$p));
    return _el$0;
  })();
}
var tui_default = Plugin.define({
  id: "opencode-memos",
  setup(context) {
    const [preferences, updatePreferences] = context.storage.memory("panel", {
      initial: {
        collapsed: false,
        group: "personal",
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
