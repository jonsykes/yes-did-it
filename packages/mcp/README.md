# yesdidit-mcp

MCP (Model Context Protocol) server for Yes! Did It — lets Claude manage your todos via natural language.

## Tools

| Tool | Description |
|------|-------------|
| `add_todo` | Create a new todo (auto-captures git context; optional `issue`, `pr` params) |
| `list_todos` | List todos with optional filters (branch, repo, tags, issue, pr) |
| `list_branch_todos` | List todos for the current git branch |
| `standup` | Standup report: recent completions + in-progress (optional `since` param) |
| `sweep_todos` | Find stale todos on deleted/merged branches |
| `complete_todo` | Mark a todo as done |
| `delete_todo` | Delete a todo |
| `update_todo` | Update a todo's text, due date, or tags |

## Setup

### Claude Desktop / claude.ai (OAuth connector)

Add as a custom connector in Claude Desktop settings:

- **URL:** `https://api.yesdidit.com/mcp`
- **Client ID:** `anthropic-connectors`
- **Client Secret:** (leave blank)

OAuth authentication is handled automatically — you'll be prompted to sign in with Google on first use.

### Claude Code (HTTP, with API key)

No local install. Create an API key with `ydi keys create --name "claude-code"`, then:

```bash
claude mcp add --transport http yesdidit https://api.yesdidit.com/mcp \
  --header "Authorization: ApiKey ydi_live_..."
```

### Claude Code / IDE extensions (stdio)

Add to `~/.claude/claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "yesdidit": {
      "command": "node",
      "args": ["/path/to/packages/mcp/dist/index.js"]
    }
  }
}
```

Uses the same credentials as the `ydi` CLI, stored at `~/.config/yesdidit/config.json`. Run `ydi login` first.

### API key (any HTTP client)

You can also use an API key instead of OAuth. Note the `ApiKey` scheme — `Bearer` is reserved for JWTs:

```bash
curl -X POST https://api.yesdidit.com/mcp \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -H "Authorization: ApiKey ydi_live_..." \
  -d '{"jsonrpc":"2.0","method":"tools/list","id":1}'
```

Create API keys with `ydi keys create`.

## Privacy

This MCP server accesses only your YesDidIt todo data:
- **Reads/writes:** Todo text, status, due dates, tags, git context (branch, commit, repo)
- **Does NOT access:** AI conversation history, uploaded files, other MCP server data, or any data outside your YesDidIt account
- **Authentication:** OAuth 2.0 with PKCE (HTTP mode) or local config file (stdio mode). Credentials are never logged or transmitted to third parties.
- **No conversation logging:** The MCP server does not store, log, or transmit any part of your Claude conversations.

Full privacy policy: https://yesdidit.com/privacy
Terms of service: https://yesdidit.com/terms
Security vulnerabilities: Report via [GitHub Security Advisories](https://github.com/jonsykes/yes-did-it/security/advisories)
