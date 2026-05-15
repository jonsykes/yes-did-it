# Yes! Did It

> Capture todos from your terminal or Claude. Check them off when you're done.

An API-first task tracker built for developers. Add and complete tasks via CLI (`ydi`), query them through Claude via MCP, or view them in the web dashboard. Fast, minimal, keyboard-driven.

---

## Quick Start

```bash
# Install the CLI
npm install -g @yesdidit/cli

# Authenticate
ydi login

# Start tracking
ydi add "Fix the bug" --due "today 5pm" --tag work
ydi list
ydi done <id>
```

## Packages

| Package | npm | Description |
|---------|-----|-------------|
| [`packages/api`](packages/api) | — | Hono.js API — auth, todos, API keys (Vercel) |
| [`packages/cli`](packages/cli) | `@yesdidit/cli` | `ydi` CLI — add, list, done, delete, login |
| [`packages/mcp`](packages/mcp) | `@yesdidit/mcp` | MCP server — manage todos from Claude Code |
| [`packages/web`](packages/web) | — | Astro web dashboard — view, filter, delete |
| [`packages/shared`](packages/shared) | — | Shared TypeScript types |

## Tech Stack

| Layer | Choice |
|-------|--------|
| API | Hono.js on Vercel (Node.js) |
| Database | Supabase Postgres + Drizzle ORM |
| Auth | Supabase Auth (Google, GitHub, PKCE for CLI) |
| Web | Astro + Svelte on Vercel |
| CLI | oclif |
| MCP | `@modelcontextprotocol/sdk` (stdio) |
| Monorepo | pnpm workspaces + Turborepo |
| E2E Tests | Playwright |

## CLI Usage

```bash
ydi login                            # Authenticate via browser (PKCE)
ydi add "Deploy the app" --due "friday 5pm" --tag work
ydi list                             # Pending todos
ydi list --done                      # Completed
ydi list --tag work --tag dev        # Filter by tags
ydi update <id> --text "New text"     # Update a todo
ydi update <id> --due "tomorrow"     # Change due date
ydi done <id>                        # Mark complete
ydi delete <id>                      # Remove
ydi keys create --name "ci"          # Create API key
ydi keys list                        # List keys
```

## MCP Setup

Two ways to connect Claude to YesDidIt:

### Option A — Claude Code over HTTP (with an API key)

No local install. Create an API key (`ydi keys create --name "claude-code"`), then:

```bash
claude mcp add --transport http yesdidit https://api.yesdidit.com/mcp \
  --header "Authorization: ApiKey ydi_live_..."
```

### Option B — Local stdio (Claude Desktop or Claude Code)

Install the MCP server:

```bash
npm install -g @yesdidit/mcp
```

Add to your Claude config (`~/Library/Application Support/Claude/claude_desktop_config.json` for Desktop):

```json
{
  "mcpServers": {
    "yesdidit": {
      "command": "yesdidit-mcp"
    }
  }
}
```

Auth is shared with the CLI (`~/.config/yesdidit/config.json`) — run `ydi login` first.

Then in Claude: *"add a todo to deploy the app by 5pm today"* — it just works.

## API Keys

For CI or programmatic access:

```bash
ydi keys create --name "github-actions"
# Returns: ydi_live_abc123...

# Use in scripts:
curl -H "Authorization: ApiKey ydi_live_abc123..." https://api.yesdidit.com/api/todos
```

## API Documentation

OpenAPI spec available at [`/api/openapi.json`](https://api.yesdidit.com/api/openapi.json).


## License

MIT
