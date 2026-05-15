# YDI MCP — Agent Guide

This file is for agents (Claude Code, etc.) calling YDI through MCP.
For the human-readable reference, see [README.md](README.md).

## Critical rules

1. **Mutations require `confirm: true`.** `add_todo`, `complete_todo`,
   `delete_todo`, `update_todo` all return a dry-run envelope by default —
   they tell you what *would* happen and don't touch state. To actually
   execute, pass `confirm: true` in the tool args.
2. **Every tool returns a markdown envelope** (`## Status / ## Result /
   ## Errors / ## Meta`). Parse those headers rather than the free-text
   body.
3. **Errors are structured.** When `isError: true`, the envelope contains
   `**Code:**`, `**Message:**`, `**Retryable:**`, often `**Suggestion:**`.
   Map codes to behavior:
   - `NOT_FOUND` → the id didn't resolve; call `list_todos` first.
   - `VALIDATION_FAILED` → likely an ambiguous short id — use more chars.
   - `UNAUTHORIZED` → the user needs to run `ydi login` in their terminal.
   - `RATE_LIMITED` → retryable; back off.

## When to use which tool

| Scenario | Tool |
|----------|------|
| Current branch's todos (most common) | `list_branch_todos({})` |
| Todos for files in the current diff | `list_file_todos({})` |
| Arbitrary filters (status, repo, PR, tag) | `list_todos({...})` |
| Page 2+ of a long `list_todos` response | `list_todos({cursor: "<from prev>"})` |
| User asks for standup | `standup({})` or `standup({since: "<iso>"})` |
| Find stale todos on deleted branches | `sweep_todos({})` |
| User asks "what's on my plate" | `get_agenda({})` (renders a widget on supporting hosts) |
| Create a todo with git context | `add_todo({text, confirm: true})` (`cwd` optional) |
| Mark done / delete / update | `complete_todo` / `delete_todo` / `update_todo` with `confirm: true` |

## Workflow recipes

### Create a todo

```ts
// 1. Preview (dry-run by default)
add_todo({ text: "Refactor login", pr: 123 })
// → ## Status: Dry-run | Would create todo
// → ## Actions: Confirm to execute: call again with `confirm: true`

// 2. Execute
add_todo({ text: "Refactor login", pr: 123, confirm: true })
// → ## Status: Success | Created todo abc12345
```

### Complete a todo

```ts
// Always preview first when the id came from the user
complete_todo({ id: "abc12345" })
// → confirms which todo you're about to mark done

complete_todo({ id: "abc12345", confirm: true })
// → ## Status: Success
```

### Pagination

```ts
list_todos({ status: "all", limit: 50 })
// → ## Meta: ... | next_cursor: 50

list_todos({ status: "all", limit: 50, cursor: "50" })
// → next page
```

## Critical: do NOT skip confirm

The pattern is intentional. Calling a mutation without `confirm: true` is
free and idempotent — it returns a dry-run envelope describing the target.
That gives you (and the user, via the assistant transcript) one last chance
to verify before state changes. Skipping straight to `confirm: true` is fine
*if you've already seen the target* (e.g. you just listed it), but for
anything user-initiated, prefer the dry-run → confirm two-step.
