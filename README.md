# OpenCode Memos

Browse grouped memos in the OpenCode V2 TUI sidebar. This is an early development
version; it does not automatically import or modify existing `memo.md` files.
All available groups are shown at once in separate sidebar sections.

## Data format

The plugin reads and writes `~/.memos/<group>/memos.json`. Each group is an
immediate subdirectory, such as `personal`. A memo has a separate title and an
unrestricted content string; Markdown is displayed as text and is not parsed
into required fields.

```json
{
  "version": 2,
  "memos": [
    {
      "id": "stable-id",
      "title": "Memo title",
      "checked": false,
      "deleted": false,
      "content": "Free-form memo content, separate from the title"
    }
  ]
}
```

`checked` is a user-controlled boolean. `deleted` hides a memo from the normal
list without removing its data; the sidebar can show and restore hidden memos.
The plugin writes group files atomically and creates new data files with
owner-only permissions. Existing `memo.md` files are left untouched unless you
copy their content into JSON.

## Install locally

Build the plugin, then add its absolute directory to the `plugins` list in
`~/.config/opencode/cli.json`:

```json
{
  "$schema": "https://opencode.ai/v2/cli.json",
  "plugins": ["/absolute/path/to/opencode-memos"]
}
```

Preserve other settings and plugins in that file. OpenCode reloads plugin
configuration automatically; use `/reload` if needed.

## Development

```sh
npm install --ignore-scripts --no-audit --no-fund
npm run check
```

Each group has its own **New** action. The editor has separate title and
multiline content fields; press **Enter** in the title to move to content, and
press **Enter** in content to save. **Ctrl+Enter** inserts a line break; **Ctrl+S**
or **Save** also saves. Press **e** in a memo's detail view to edit its title and
content. **Esc** or **Cancel** discards unsaved changes.
