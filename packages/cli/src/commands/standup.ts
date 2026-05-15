import { Command, Flags } from "@oclif/core"
import * as chrono from "chrono-node"
import { listTodos, type Todo } from "../lib/api-client"
import { getSetting } from "../lib/settings"
import { formatMarkdownTable } from "../shared"
import {
  agentFlag,
  compactFlag,
  fieldsFlag,
  parseFields,
  renderAgentError,
  renderAgentSuccess,
} from "../lib/agent"

const DEFAULT_AGENT_FIELDS = ["id", "branch", "text", "pr", "completed_at"] as const

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
    agent: agentFlag,
    fields: fieldsFlag,
    compact: compactFlag,
  }

  static agentMeta = {
    examples: [
      "ydi standup --agent",
      "ydi standup --agent --compact",
      "ydi standup --agent --since '7 days ago'",
    ],
    related: ["ydi list --agent", "ydi context --agent"],
  }

  async run(): Promise<void> {
    const { flags } = await this.parse(Standup)
    const startedAt = Date.now()
    const command = `ydi standup${flags.agent ? " --agent" : ""}${flags.since ? ` --since "${flags.since}"` : ""}`

    const cutoff = this.parseCutoff(flags.since, flags.agent, command, startedAt)

    try {
      const [completed, pending] = await Promise.all([
        listTodos({ status: "done", completed_since: cutoff.toISOString(), limit: 200 }),
        listTodos({ status: "pending", has_context: true, limit: 200 }),
      ])

      if (flags.agent) {
        this.log(
          renderStandupAgent({
            command,
            cutoff,
            completed,
            pending,
            fieldsFlag: flags.fields,
            startedAt,
            compact: flags.compact,
          }),
        )
        return
      }

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
      if (flags.agent) {
        const { output, exitCode } = renderAgentError(command, err, startedAt)
        this.log(output)
        this.exit(exitCode)
      }
      this.error(err instanceof Error ? err.message : String(err))
    }
  }

  private parseCutoff(
    since: string | undefined,
    agent: boolean,
    command: string,
    startedAt: number,
  ): Date {
    if (since) {
      const duration = parseDuration(since)
      if (duration) return new Date(Date.now() - duration)

      const timezone = getSetting("timezone") as string
      const parsed = chrono.parseDate(since, { timezone })
      if (parsed) return parsed

      if (agent) {
        const { output, exitCode } = renderAgentError(
          command,
          new Error(`Could not parse --since: "${since}"`),
          startedAt,
        )
        this.log(output)
        this.exit(exitCode)
      }
      this.error(`Could not parse --since: "${since}"`)
    }

    const defaultSince = getSetting("standup.since") as string
    const duration = parseDuration(defaultSince)
    if (duration) return new Date(Date.now() - duration)

    return new Date(Date.now() - 24 * 60 * 60 * 1000)
  }
}

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

interface RenderStandupAgentParams {
  command: string
  cutoff: Date
  completed: Todo[]
  pending: Todo[]
  fieldsFlag?: string
  startedAt: number
  compact?: boolean
}

function renderStandupAgent(params: RenderStandupAgentParams): string {
  const { command, cutoff, completed, pending, fieldsFlag, startedAt, compact } = params
  const fields = parseFields(fieldsFlag) ?? [...DEFAULT_AGENT_FIELDS]

  const sections: string[] = []
  sections.push(`Since: ${cutoff.toISOString()}`)
  sections.push("")
  sections.push("### Completed")
  sections.push(renderBranchGroupedTable(completed, fields))
  sections.push("")
  sections.push("### In Progress")
  sections.push(renderBranchGroupedTable(pending, fields))

  const summary = `${completed.length} completed | ${pending.length} in progress`

  const actions: string[] = []
  if (completed.length === 0 && pending.length === 0) {
    actions.push("Widen window: `ydi standup --since '7 days ago' --agent`")
  } else {
    actions.push("Widen window: `ydi standup --since '7 days ago' --agent`")
  }
  if (pending.length > 0) {
    actions.push("List pending todos: `ydi list --agent`")
  }

  return renderAgentSuccess({
    command,
    statusSummary: summary,
    result: sections.join("\n"),
    actions,
    startedAt,
    compact,
    meta: { since: `since: ${cutoff.toISOString()}` },
  })
}

function renderBranchGroupedTable(todos: Todo[], fields: string[]): string {
  if (todos.length === 0) return "_None_"

  const { branched, unbranched } = groupByBranch(todos)
  const blocks: string[] = []

  for (const [branch, items] of branched) {
    blocks.push(`**${branch}** (${items.length})`)
    blocks.push(formatMarkdownTable(items.map(projectTodo), fields))
    blocks.push("")
  }

  if (unbranched.length > 0) {
    blocks.push(`**(no branch)** (${unbranched.length})`)
    blocks.push(formatMarkdownTable(unbranched.map(projectTodo), fields))
  }

  return blocks.join("\n").trim()
}

function projectTodo(t: Todo): Record<string, unknown> {
  return {
    id: t.id.slice(0, 8),
    status: t.status,
    text: t.text,
    branch: t.context?.branch ?? "",
    pr: t.context?.pr ?? "",
    issue: t.context?.issue ?? "",
    completed_at: t.completed_at ?? "",
    repo: t.context?.repo ?? "",
  }
}
