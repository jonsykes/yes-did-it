---
name: ydi-add
description: Quick-add a todo to Yes! Did It with natural language. Use when the user says things like "remind me to", "I need to", "add a todo", or "don't forget to".
argument-hint: [description] [--due time] [--tags tag1,tag2]
allowed-tools: Bash
---

# Add a Todo

Use the `ydi` CLI to add a todo. Parse the user's natural language into the appropriate flags.

## Rules

1. Always confirm what was added after the command succeeds
2. If the user mentions a time or deadline, pass it via `--due` using natural language (chrono-node parses it)
3. If the user mentions categories or labels, pass them via `--tags` (comma-separated)
4. If the description is ambiguous, add the todo with your best interpretation — don't ask for clarification on simple tasks

## Examples

User: "remind me to review the PR by 3pm"
```bash
ydi add "Review the PR" --due "today 3pm"
```

User: "I need to deploy staging and update the docs, tag both as release"
```bash
ydi add "Deploy staging" --tags release
ydi add "Update the docs" --tags release
```

User: "don't forget groceries tomorrow morning"
```bash
ydi add "Groceries" --due "tomorrow morning"
```
Always confirm back to the user "Yes! Did it, I added <summarize the todo>."