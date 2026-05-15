import { Command, Args, Flags } from "@oclif/core"
import * as chrono from "chrono-node"
import { updateTodo, findTodoByIdOrPrefix } from "../lib/api-client"
import { pickTodo } from "../lib/picker"
import { formatKeyValue } from "../shared"
import {
  agentFlag,
  confirmFlag,
  fieldsFlag,
  parseFields,
  renderAgentDryRun,
  renderAgentError,
  renderAgentSuccess,
} from "../lib/agent"

const DEFAULT_UPDATE_FIELDS = ["id", "text", "status", "due_at", "tags"] as const

export default class Update extends Command {
  static description = "Update a todo's text, due date, or tags"

  static args = {
    id: Args.string({ required: false, description: "Todo ID or prefix (omit to pick interactively)" }),
  }

  static flags = {
    text: Flags.string({
      description: "New todo text",
    }),
    due: Flags.string({
      char: "d",
      description: 'New due date/time, e.g. "today 3pm", "tomorrow 9am", "2026-04-01T17:00:00Z"',
    }),
    "clear-due": Flags.boolean({
      description: "Remove the due date",
      default: false,
    }),
    tag: Flags.string({
      char: "t",
      description: "Tag (can be used multiple times, replaces existing tags)",
      multiple: true,
    }),
    "clear-tags": Flags.boolean({
      description: "Remove all tags",
      default: false,
    }),
    json: Flags.boolean({
      description: "Output as JSON",
      default: false,
    }),
    agent: agentFlag,
    confirm: confirmFlag,
    fields: fieldsFlag,
  }

  async run(): Promise<void> {
    const { args, flags } = await this.parse(Update)
    const startedAt = Date.now()
    const command = buildUpdateCommand(args.id, flags)

    if (flags.text === undefined && !flags.due && !flags["clear-due"] && !flags.tag && !flags["clear-tags"]) {
      return this.failVal(
        flags.agent,
        command,
        "Provide at least one of --text, --due, --clear-due, --tag, or --clear-tags",
        startedAt,
      )
    }

    if (flags["clear-due"] && flags.due) {
      return this.failVal(flags.agent, command, "Cannot use --due and --clear-due together", startedAt)
    }

    if (flags.agent && !args.id) {
      return this.failVal(
        true,
        command,
        "An id argument is required with --agent (interactive picker is disabled).",
        startedAt,
      )
    }

    try {
      const body: { text?: string; due_at?: string | null; tags?: string[] } = {}

      if (flags.text !== undefined) {
        body.text = flags.text
      }

      if (flags["clear-due"]) {
        body.due_at = null
      } else if (flags.due) {
        const parsed = chrono.parseDate(flags.due)
        if (!parsed) {
          return this.failVal(flags.agent, command, `Could not parse due date: "${flags.due}"`, startedAt)
        }
        body.due_at = parsed.toISOString()
      }

      if (flags["clear-tags"]) {
        body.tags = []
      } else if (flags.tag) {
        body.tags = flags.tag
      }

      if (flags.agent && !flags.confirm) {
        const todo = await findTodoByIdOrPrefix(args.id!)
        const fields = parseFields(flags.fields) ?? [...DEFAULT_UPDATE_FIELDS]
        const preview: Record<string, unknown> = {
          id: todo.id.slice(0, 8),
          text: body.text ?? todo.text,
          status: todo.status,
          due_at: body.due_at !== undefined ? (body.due_at ?? "") : (todo.due_at ?? ""),
          tags: body.tags ?? todo.tags,
        }
        const changes: string[] = []
        if (body.text !== undefined) changes.push(`text → "${body.text}"`)
        if (body.due_at === null) changes.push("clear due_at")
        else if (body.due_at) changes.push(`due_at → ${body.due_at}`)
        if (body.tags !== undefined) {
          changes.push(`tags → [${body.tags.join(", ")}]`)
        }
        this.log(
          renderAgentDryRun({
            command,
            statusSummary: `Would update 1 todo (${changes.length} change${changes.length === 1 ? "" : "s"})`,
            result: formatKeyValue(preview, fields),
            confirmCommand: `${command} --confirm`,
            startedAt,
            meta: { id: `id: ${todo.id}`, changes: `changes: ${changes.join("; ")}` },
          }),
        )
        return
      }

      const id = args.id ?? (await pickTodo({ message: "Update:", status: "all" }))
      const todo = await updateTodo(id, body)

      if (flags.agent) {
        const fields = parseFields(flags.fields) ?? [...DEFAULT_UPDATE_FIELDS]
        const row: Record<string, unknown> = {
          id: todo.id.slice(0, 8),
          text: todo.text,
          status: todo.status,
          due_at: todo.due_at ?? "",
          tags: todo.tags,
        }
        this.log(
          renderAgentSuccess({
            command,
            statusSummary: "Updated 1 todo",
            result: formatKeyValue(row, fields),
            actions: [`Verify: \`ydi list --all --agent\``],
            startedAt,
            meta: { id: `id: ${todo.id}` },
          }),
        )
        return
      }

      if (flags.json) {
        this.log(JSON.stringify(todo, null, 2))
        return
      }

      this.log(`Updated: ${todo.id.slice(0, 8)}  ${todo.text}`)
      if (todo.due_at) {
        this.log(`  Due: ${formatDate(todo.due_at)}`)
      }
      if (todo.tags.length > 0) {
        this.log(`  Tags: ${todo.tags.join(", ")}`)
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

  private failVal(agent: boolean, command: string, message: string, startedAt: number): never {
    if (agent) {
      const { output, exitCode } = renderAgentError(command, new Error(message), startedAt)
      this.log(output)
      this.exit(exitCode)
    }
    this.error(message)
  }
}

function buildUpdateCommand(id: string | undefined, flags: Record<string, unknown>): string {
  const parts = ["ydi update"]
  if (id) parts.push(id)
  if (typeof flags.text === "string") parts.push(`--text ${JSON.stringify(flags.text)}`)
  if (typeof flags.due === "string") parts.push(`--due ${JSON.stringify(flags.due)}`)
  if (flags["clear-due"]) parts.push("--clear-due")
  if (Array.isArray(flags.tag)) {
    for (const t of flags.tag as string[]) parts.push(`--tag ${JSON.stringify(t)}`)
  }
  if (flags["clear-tags"]) parts.push("--clear-tags")
  if (flags.agent) parts.push("--agent")
  if (flags.fields) parts.push(`--fields ${flags.fields}`)
  return parts.join(" ")
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  })
}
