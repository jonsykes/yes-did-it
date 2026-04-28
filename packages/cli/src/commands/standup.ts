import { Command, Flags } from "@oclif/core"
import * as chrono from "chrono-node"
import { listTodos, type Todo } from "../lib/api-client"
import { getSetting } from "../lib/settings"

export default class Standup extends Command {
  static description = "Show standup report: recently completed and in-progress todos"

  static flags = {
    since: Flags.string({
      char: "s",
      description: 'Lookback period, e.g. "yesterday 9am", "2 days ago", "48h"',
    }),
    json: Flags.boolean({
      description: "Output as JSON",
      default: false,
    }),
  }

  async run(): Promise<void> {
    const { flags } = await this.parse(Standup)

    const cutoff = this.parseCutoff(flags.since)

    try {
      const [completed, pending] = await Promise.all([
        listTodos({ status: "done", completed_since: cutoff.toISOString(), limit: 200 }),
        listTodos({ status: "pending", has_context: true, limit: 200 }),
      ])

      if (flags.json) {
        this.log(JSON.stringify({
          since: cutoff.toISOString(),
          completed: groupForJson(completed),
          in_progress: groupForJson(pending),
        }, null, 2))
        return
      }

      this.log(`Standup (since ${formatSince(cutoff)}):`)
      this.log("")

      if (completed.length === 0) {
        this.log("Completed: none")
      } else {
        this.log("Completed:")
        printBranchGroups(completed, this)
      }

      this.log("")

      if (pending.length === 0) {
        this.log("In Progress: none")
      } else {
        this.log("In Progress:")
        printPendingSummary(pending, this)
      }
    } catch (err) {
      this.error(err instanceof Error ? err.message : String(err))
    }
  }

  private parseCutoff(since?: string): Date {
    if (since) {
      // Try duration format first (e.g. "24h", "48h", "8h")
      const duration = parseDuration(since)
      if (duration) return new Date(Date.now() - duration)

      // Try natural language via chrono
      const timezone = getSetting("timezone") as string
      const parsed = chrono.parseDate(since, { timezone })
      if (parsed) return parsed

      this.error(`Could not parse --since: "${since}"`)
    }

    // Use default from settings
    const defaultSince = getSetting("standup.since") as string
    const duration = parseDuration(defaultSince)
    if (duration) return new Date(Date.now() - duration)

    // Fallback: 24 hours
    return new Date(Date.now() - 24 * 60 * 60 * 1000)
  }
}

/** Parse duration strings like "24h", "8h", "48h" into milliseconds. */
function parseDuration(s: string): number | null {
  const match = s.match(/^(\d+)h$/)
  if (!match) return null
  return parseInt(match[1]) * 60 * 60 * 1000
}

type BranchTodo = Todo & { context: NonNullable<Todo["context"]> & { branch: string } }

function groupByBranch(todos: Todo[]): { branched: Map<string, BranchTodo[]>; unbranched: Todo[] } {
  const branched = new Map<string, BranchTodo[]>()
  const unbranched: Todo[] = []

  for (const todo of todos) {
    if (todo.context?.branch) {
      const branch = todo.context.branch
      const list = branched.get(branch) ?? []
      list.push(todo as BranchTodo)
      branched.set(branch, list)
    } else {
      unbranched.push(todo)
    }
  }

  return { branched, unbranched }
}

function printBranchGroups(todos: Todo[], cmd: Command): void {
  const { branched, unbranched } = groupByBranch(todos)

  for (const [branch, items] of branched) {
    const pr = items[0]?.context?.pr
    const suffix = pr ? ` (PR #${pr})` : ""
    cmd.log(`  ${branch}${suffix}:`)
    for (const todo of items) {
      cmd.log(`    - ${todo.text}`)
    }
  }

  if (unbranched.length > 0) {
    cmd.log("  (no branch):")
    for (const todo of unbranched) {
      cmd.log(`    - ${todo.text}`)
    }
  }
}

function printPendingSummary(todos: Todo[], cmd: Command): void {
  const { branched, unbranched } = groupByBranch(todos)

  for (const [branch, items] of branched) {
    const count = items.length
    cmd.log(`  ${branch} [${count} todo${count === 1 ? "" : "s"}]`)
  }

  if (unbranched.length > 0) {
    const count = unbranched.length
    cmd.log(`  (no branch) [${count} todo${count === 1 ? "" : "s"}]`)
  }
}

function groupForJson(todos: Todo[]): { branch: string | null; todos: Todo[] }[] {
  const { branched, unbranched } = groupByBranch(todos)
  const groups: { branch: string | null; todos: Todo[] }[] = []

  for (const [branch, items] of branched) {
    groups.push({ branch, todos: items })
  }

  if (unbranched.length > 0) {
    groups.push({ branch: null, todos: unbranched })
  }

  return groups
}

function formatSince(date: Date): string {
  const now = new Date()
  const diffMs = now.getTime() - date.getTime()
  const hours = Math.round(diffMs / (60 * 60 * 1000))

  if (hours < 24) return `${hours}h ago`
  const days = Math.round(hours / 24)
  return `${days} day${days === 1 ? "" : "s"} ago`
}
