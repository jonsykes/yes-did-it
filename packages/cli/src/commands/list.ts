import { Command, Flags } from "@oclif/core"
import { listTodos, type Todo } from "../lib/api-client"
import { getBranch, getRemoteUrl, getAllRemoteBranches, branchLastCommitDate } from "../shared"
import { getSetting, shouldUseColor } from "../lib/settings"

const FILTERS = ["today", "tomorrow", "this-week", "overdue", "upcoming", "next-hour", "all"] as const

export default class List extends Command {
  static description = "List todos"

  static flags = {
    filter: Flags.string({
      char: "f",
      description: `Time filter: ${FILTERS.join(", ")}`,
      options: [...FILTERS],
    }),
    done: Flags.boolean({
      description: "Show completed todos instead of pending",
      default: false,
    }),
    all: Flags.boolean({
      description: "Show all todos regardless of status",
      default: false,
    }),
    tag: Flags.string({
      char: "t",
      description: "Filter by tag",
    }),
    "current-branch": Flags.boolean({
      description: "Filter by current git branch",
      default: false,
    }),
    branch: Flags.string({
      char: "b",
      description: "Filter by branch name",
    }),
    here: Flags.boolean({
      description: "Filter by current git repo",
      default: false,
    }),
    repo: Flags.string({
      description: "Filter by repo URL",
    }),
    file: Flags.string({
      description: "Filter by file path in files_changed context",
    }),
    "git-tag": Flags.string({
      description: "Filter by git tag / release version",
    }),
    issue: Flags.integer({
      description: "Filter by GitHub issue number",
    }),
    pr: Flags.integer({
      description: "Filter by GitHub PR number",
    }),
    stale: Flags.boolean({
      description: "Show only todos on branches deleted from remote (stale)",
      default: false,
    }),
    active: Flags.boolean({
      description: "Show only todos on branches with recent commits (last 7 days)",
      default: false,
    }),
    verbose: Flags.boolean({
      char: "v",
      description: "Show full git context for each todo",
      default: false,
    }),
    limit: Flags.integer({
      description: "Max results",
      default: 50,
    }),
    json: Flags.boolean({
      description: "Output as JSON",
      default: false,
    }),
  }

  async run(): Promise<void> {
    const { flags } = await this.parse(List)

    const defaultFilter = getSetting("default_filter") as string
    const hasExplicitStatus = flags.all || flags.done
    const status = flags.all ? "all" : flags.done ? "done" : defaultFilter === "all" ? "all" : "pending"
    const filter = flags.filter ?? (defaultFilter === "today" && !hasExplicitStatus ? "today" : undefined)

    let branch = flags.branch
    let repo = flags.repo

    if (flags["current-branch"]) {
      const detected = getBranch()
      if (!detected) {
        this.error("Not in a git repository. Use --branch <name> to filter by a specific branch.")
      }
      branch = detected
    }

    if (flags.here) {
      const detected = getRemoteUrl()
      if (!detected) {
        this.error("Not in a git repository or no remote configured. Use --repo <url> to filter by a specific repo.")
      }
      repo = detected
    }

    try {
      let todos = await listTodos({
        filter,
        status,
        tags: flags.tag,
        limit: flags.limit,
        branch,
        repo,
        issue: flags.issue,
        pr: flags.pr,
        file: flags.file,
        git_tag: flags["git-tag"],
        has_context: (flags.stale || flags.active) ? true : undefined,
      })

      // --active: filter to todos on branches with recent commits (last 7 days)
      if (flags.active) {
        const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)
        todos = todos.filter((t) => {
          if (!t.context?.branch) return false
          const lastCommit = branchLastCommitDate(t.context.branch)
          return lastCommit !== null && lastCommit > sevenDaysAgo
        })
      }

      // --stale: filter to only todos on branches deleted from remote
      if (flags.stale) {
        const remoteBranches = getAllRemoteBranches()
        if (remoteBranches.size === 0) {
          this.error("Could not reach remote. Cannot determine stale branches.")
        }
        todos = todos.filter(
          (t) => t.context?.branch && !remoteBranches.has(t.context.branch)
        )
      }

      if (flags.json) {
        this.log(JSON.stringify(todos, null, 2))
        return
      }

      if (flags.active) {
        this.log("Active todos (branch has commits in last 7 days):")
        this.log("")
      } else if (flags.stale) {
        this.log("Stale todos (branch deleted on remote):")
        this.log("")
      } else if (branch) {
        this.log(`Todos on branch: ${branch}`)
        this.log("")
      } else if (repo) {
        this.log(`Todos in repo: ${repo}`)
        this.log("")
      }

      if (todos.length === 0) {
        this.log(flags.active ? "No active todos found." : flags.stale ? "No stale todos found." : "No todos found.")
        return
      }

      const verbose = flags.verbose || (getSetting("verbose") as boolean)
      const color = shouldUseColor()
      const dateFormat = getSetting("date_format") as string

      for (const todo of todos) {
        this.log(formatTodo(todo, verbose, color, dateFormat))
        if (verbose && todo.context) {
          this.log(formatContext(todo.context))
        }
      }
    } catch (err) {
      this.error(err instanceof Error ? err.message : String(err))
    }
  }
}

function formatTodo(todo: Todo, verbose = false, color = true, dateFormat = "relative"): string {
  const mark = color ? (todo.status === "done" ? "✓" : "·") : (todo.status === "done" ? "[x]" : "[ ]")
  const due = todo.due_at ? `  ${formatDue(todo.due_at, dateFormat)}` : ""
  const tags = todo.tags.length > 0 ? `  [${todo.tags.join(", ")}]` : ""
  const id = todo.id.slice(0, 8)
  const issueStr = !verbose && todo.context?.issue ? `  #${todo.context.issue}` : ""
  const prStr = !verbose && todo.context?.pr ? `  PR #${todo.context.pr}` : ""
  const branchSuffix = !verbose && todo.context?.branch ? `  [${todo.context.branch}]` : ""
  // Pad text to 40 chars for alignment
  const text = todo.text.length > 40 ? todo.text.slice(0, 39) + "…" : todo.text.padEnd(40)
  return `${mark} ${id}  ${text}${due}${tags}${issueStr}${prStr}${branchSuffix}`
}

function formatContext(context: NonNullable<Todo["context"]>): string {
  const lines: string[] = []
  if (context.branch) lines.push(`    branch: ${context.branch}`)
  if (context.commit) lines.push(`    commit: ${context.commit}`)
  if (context.repo) lines.push(`    repo:   ${context.repo}`)
  if (context.issue) lines.push(`    issue:  #${context.issue}`)
  if (context.pr) lines.push(`    pr:     #${context.pr}`)
  if (context.tag) lines.push(`    tag:    ${context.tag}`)
  if (context.files_changed?.length) lines.push(`    files:  ${context.files_changed.join(", ")}`)
  if (context.worktree) lines.push(`    worktree: yes`)
  return lines.join("\n")
}

function formatDue(iso: string, dateFormat = "relative"): string {
  if (dateFormat === "iso") return iso
  if (dateFormat === "short") {
    const d = new Date(iso)
    return d.toLocaleDateString("en-US", { month: "short", day: "numeric" }) + " " +
      d.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" })
  }
  if (dateFormat === "local") return new Date(iso).toLocaleString()
  // "relative" — default behavior below
  const d = new Date(iso)
  const now = new Date()
  const startOfToday = new Date(now)
  startOfToday.setHours(0, 0, 0, 0)
  const startOfTomorrow = new Date(startOfToday)
  startOfTomorrow.setDate(startOfTomorrow.getDate() + 1)
  const startOfDayAfter = new Date(startOfTomorrow)
  startOfDayAfter.setDate(startOfDayAfter.getDate() + 1)

  const time = d.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" })

  if (d < startOfToday) {
    return `overdue (${d.toLocaleDateString("en-US", { month: "short", day: "numeric" })} ${time})`
  }
  if (d < startOfTomorrow) return `today ${time}`
  if (d < startOfDayAfter) return `tomorrow ${time}`
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" }) + " " + time
}
