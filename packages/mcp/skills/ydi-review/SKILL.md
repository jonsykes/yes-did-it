---
name: ydi-review
description: Review what's on your plate — show due, overdue, and upcoming todos from Yes! Did It. Use when the user asks "what do I have today", "what's due", "am I behind", or wants a status check before starting work.
allowed-tools: Bash
---

# Review Todos

Give the user a quick status check of their todos using the `ydi` CLI.

## Rules

1. Always check overdue items first — these need attention
2. Then show today's items
3. Optionally mention upcoming items if the user seems to be planning ahead
4. Keep the summary conversational and scannable
5. If there are no items in a category, skip it — don't say "you have 0 overdue items"

## Steps

```bash
ydi list --filter overdue --json
ydi list --filter today --json
ydi list --filter upcoming --json
```

## Output Format

Summarize the results conversationally. For example:

> You have 2 overdue items that need attention:
> - "Update API docs" (was due yesterday)
> - "Review PR #42" (was due Monday)
>
> 3 things due today:
> - "Deploy staging" (by 2pm)
> - "Team standup notes"
> - "Send weekly report" (by 5pm)
>
> Looking ahead, you have 4 items coming up this week.

If everything is clear, say so: "Yes! Did it, you're all caught up — nothing overdue and nothing due today."
