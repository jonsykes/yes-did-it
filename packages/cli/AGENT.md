# YDI CLI — Agent Guide

This file is for agents (Claude Code, Cursor, etc.) shelling out to `ydi`.
For the human-readable reference, see [README.md](README.md).

## Critical rules

1. **Always pass `--agent`.** Without it, output is human-prose and slower to
   parse. With it, you get a markdown envelope (`# / ## Status / ## Result /
   ## Errors / ## Meta`) and semantic exit codes (`NOT_FOUND=3`,
   `PERMISSION_DENIED=4`, `RATE_LIMITED=6`, `VALIDATION_FAILED=8`, etc).
2. **Always pass `--confirm` explicitly** when mutating. With `--agent` alone,
   mutations (`add`, `done`, `delete`, `update`, `keys create`, `config set`,
   `hooks install`/`uninstall`, `sweep --auto`) dry-run by default — they
   print "Would do X" and exit 0 without touching state. To execute, add
   `--confirm`.
3. **Prefer `--fields` for list output.** `ydi list --agent --fields
   id,text,branch` is meaningfully cheaper than the default column set.
4. **Use `--compact` for large reads** (`list`, `standup`). Drops Warnings/
   Actions and inlines Meta — ~30%+ smaller for typical pages.
5. **Discover schema at runtime, not from memory.** Run `ydi --agent describe`
   for the command index, or `ydi <cmd> --agent describe` for flags,
   examples, and related commands.

## Common workflows

### Daily standup

```bash
ydi standup --agent --compact
```

Returns completed-since-yesterday grouped by branch + in-progress counts.
Widen with `--since '7 days ago'`.

### Find stale todos before sweep

```bash
ydi list --agent --stale            # see what would be swept
ydi sweep --agent --auto --confirm  # actually complete them
```

### Find todos touching files in the current diff

```bash
ydi list --agent --here   # all todos in current repo
ydi list --agent --file packages/api/src/routes/todos.ts
```

### Link a todo to a PR

```bash
ydi add "Track PR review feedback" --agent --confirm --pr 123
```

Git context (branch, commit, repo) is auto-captured. Disable with
`--no-context`.

### Page through a long list

```bash
ydi list --agent --limit 50
# response Meta includes: next_cursor: 50
ydi list --agent --limit 50 --cursor 50
```

The Actions section always names the next-page command verbatim.

## Error recovery

| Exit | Code | Meaning | What to do |
|------|------|---------|-----------|
| 0 | SUCCESS | Worked, or dry-run rendered | If dry-run, retry with `--confirm`. |
| 3 | NOT_FOUND | Id didn't resolve | Run `ydi list --agent --all` and pick a real id. |
| 4 | PERMISSION_DENIED | Not logged in / session expired | `ydi login` once, then retry. |
| 6 | RATE_LIMITED | API limit hit | The error envelope sets `retryable: Yes`. Wait then retry. |
| 8 | VALIDATION_FAILED | Bad input (ambiguous id, malformed flag) | Read the Suggestion line — it usually tells you exactly what to fix. |

All errors print a structured envelope with `**Code:**`, `**Message:**`,
`**Retryable:**`, and often `**Suggestion:**`. Parse those lines instead of
the free-text status summary.

## Tips

- `--agent` wins over `--json` if both are passed. The envelope is always
  markdown; the JSON path is for legacy non-agent integrations.
- `--fields` accepts a CSV of any column name shown in the default table
  (e.g. `id,status,text,branch,due,tags,issue,pr,repo,commit,
  completed_at,created_at`).
- Timing and tool version are always in the Meta line — useful for
  attributing latency.
