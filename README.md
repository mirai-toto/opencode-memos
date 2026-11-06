# OpenCode Memos

Browse grouped memos in the OpenCode V2 TUI sidebar. This is an early development
version; it does not migrate or modify existing `memo.md` files.

## Data format

The plugin reads and writes `~/.memos/<group>/memos.json`. Each group is an
immediate subdirectory, such as `personal`. Memo content is an unrestricted
string; Markdown is displayed as text and is not parsed into required fields.

```json
{
  "version": 1,
  "memos": [
    {
      "id": "stable-id",
      "checked": false,
      "deleted": false,
      "content": "Free-form memo content"
    }
  ]
}
```

`checked` is a user-controlled boolean. `deleted` hides a memo from the normal
list without removing its data; the sidebar can show and restore hidden memos.
The plugin writes group files atomically and creates new data files with
owner-only permissions. Existing `memo.md` files are left untouched. Importing
or splitting those files is intentionally not automatic yet.

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

The quick **New** action currently uses the TUI's single-line prompt. Existing
JSON entries can contain multiline Markdown. A multiline editor and a reviewed
import path for the current Markdown memos are follow-up work.
