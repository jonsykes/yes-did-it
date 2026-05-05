# Yes! Did It — Claude Skills

Slash commands for managing todos from within Claude Code.

| Skill | Description |
|-------|-------------|
| `/ydi-add` | Quick-add a todo with natural language |
| `/ydi-plan` | Break a goal into multiple todos and batch-add them |
| `/ydi-review` | Check what's due, overdue, and upcoming |
| `/ydi-deploy-gate` | Verify release todos are done before deploying |

## Setup

These skills are bundled with the `@yesdidit/mcp` package. To use them, copy the `skills` directory into your project or personal skills folder:

```bash
# Per-project
cp -r node_modules/@yesdidit/mcp/skills .claude/skills/

# Personal (all projects)
cp -r node_modules/@yesdidit/mcp/skills/* ~/.claude/skills/
```

Then use them in Claude Code by typing `/ydi-add`, `/ydi-review`, etc.
