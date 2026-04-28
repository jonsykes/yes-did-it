# @yesdidit/cli

The `ydi` command-line tool for [Yes! Did It](https://yesdidit.com).

## Commands

```
ydi login               Log in via Google or GitHub OAuth
ydi logout              Clear stored credentials
ydi add "text"          Add a todo
  --due "today 3pm"     Set a due date (natural language)
  --tag work            Add a tag (repeatable)
  --issue/-i 42         Link to GitHub issue (or owner/repo#42)
  --pr 28               Link to GitHub PR number
  --no-context          Skip automatic git context capture
ydi context             Show git context for current directory
ydi list                List pending todos
  --filter today        Filter by time window
  --done                Show completed todos
  --all                 Show all todos
  --tag work            Filter by tag
  --current-branch      Filter by current git branch
  --branch feat/x       Filter by branch name
  --here                Filter by current git repo
  --repo <url>          Filter by repo URL
  --issue 42            Filter by GitHub issue number
  --pr 28               Filter by GitHub PR number
  --stale               Show todos on deleted/merged branches
  --active              Show todos on branches with recent commits (7d)
  --verbose / -v        Show full git context per todo
ydi standup             Standup report: completed + in-progress
  --since "yesterday"   Lookback period (natural language or "24h")
  --json                Structured output
ydi config set <k> <v>  Set a config value
ydi config get <k>      Get a config value
ydi config list         List all config values
ydi sweep               Find and clean up stale todos
  --dry-run             List stale todos without acting
  --auto                Mark all stale as done (no prompt)
  --json                Structured output
ydi update <id>         Update a todo
  --text "new text"     Change the text
  --due "tomorrow 9am"  Change the due date
  --clear-due           Remove the due date
  --tag work            Replace tags (repeatable)
  --clear-tags          Remove all tags
ydi done <id>           Mark a todo as done
ydi delete <id>         Delete a todo
```

## Development

```bash
pnpm build        # compile TypeScript → dist/
npm link          # install ydi globally from local build
```
