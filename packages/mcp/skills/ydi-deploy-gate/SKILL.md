---
name: ydi-deploy-gate
description: Check whether all required todos are done before deploying. Use when the user is about to deploy, release, or ship and wants to verify nothing was missed.
argument-hint: [tag to check, e.g. "release" or "v2-launch"]
allowed-tools: Bash
---

# Deploy Gate Check

Verify that all todos tagged with a release or deploy label are completed before proceeding.

## Rules

1. If the user specifies a tag, filter by that tag. Otherwise default to checking `release` and `deploy` tags.
2. If open todos remain, list them clearly and advise against deploying
3. If all todos are done, give a clear green light
4. Never skip or auto-complete todos — the user must explicitly mark them done

## Steps

```bash
ydi list --tags <tag> --json
```

## Output

### Yes! Did it, all clear
> Deploy gate passed — all 5 release todos are done. You're clear to ship.

### Blocked
> Deploy gate: 2 of 7 release todos are still open:
> - "Update migration script"
> - "Add rate limit to /api/bulk"
>
> Finish these before deploying, or mark them done with `ydi done <id>` if they're resolved.
