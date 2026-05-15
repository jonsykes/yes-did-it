import { Command, Args, Flags } from "@oclif/core"
import { markDone, findTodoByIdOrPrefix } from "../lib/api-client"
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

const DEFAULT_DONE_FIELDS = ["id", "text", "status", "completed_at"] as const

export default class Done extends Command {
  static description = "Mark a todo as done"

  static args = {
    id: Args.string({ required: false, description: "Todo ID or prefix (omit to pick interactively)" }),
  }

  static flags = {
    json: Flags.boolean({
      description: "Output as JSON",
      default: false,
    }),
    agent: agentFlag,
    confirm: confirmFlag,
    fields: fieldsFlag,
  }

  static agentMeta = {
    examples: [
      "ydi done abc12345 --agent",
      "ydi done abc12345 --agent --confirm",
    ],
    related: ["ydi list --agent", "ydi update --agent"],
  }

  async run(): Promise<void> {
    const { args, flags } = await this.parse(Done)
    const startedAt = Date.now()
    const command = buildDoneCommand(args.id, flags)

    if (flags.agent && !args.id) {
      return this.failVal(
        true,
        command,
        "An id argument is required with --agent (interactive picker is disabled).",
        startedAt,
      )
    }

    try {
      if (flags.agent && !flags.confirm) {
        const todo = await findTodoByIdOrPrefix(args.id!)
        const fields = parseFields(flags.fields) ?? [...DEFAULT_DONE_FIELDS]
        const preview: Record<string, unknown> = {
          id: todo.id.slice(0, 8),
          text: todo.text,
          status: todo.status,
          completed_at: todo.completed_at ?? "",
        }
        this.log(
          renderAgentDryRun({
            command,
            statusSummary: todo.status === "done"
              ? "Already done — would be a no-op"
              : "Would mark 1 todo as done",
            result: formatKeyValue(preview, fields),
            confirmCommand: `${command} --confirm`,
            startedAt,
            meta: { id: `id: ${todo.id}` },
          }),
        )
        return
      }

      const id = args.id ?? (await pickTodo({ message: "Mark done:" }))
      const todo = await markDone(id)

      if (flags.agent) {
        const fields = parseFields(flags.fields) ?? [...DEFAULT_DONE_FIELDS]
        const row: Record<string, unknown> = {
          id: todo.id.slice(0, 8),
          text: todo.text,
          status: todo.status,
          completed_at: todo.completed_at ?? "",
        }
        this.log(
          renderAgentSuccess({
            command,
            statusSummary: "Marked 1 todo as done",
            result: formatKeyValue(row, fields),
            actions: [
              `Verify: \`ydi list --done --agent\``,
              `Reopen (dry-run): \`ydi update ${todo.id.slice(0, 8)} --agent\``,
            ],
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

      this.log(`Done: ${todo.id.slice(0, 8)}  ${todo.text}`)
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

function buildDoneCommand(id: string | undefined, flags: Record<string, unknown>): string {
  const parts = ["ydi done"]
  if (id) parts.push(id)
  if (flags.agent) parts.push("--agent")
  if (flags.fields) parts.push(`--fields ${flags.fields}`)
  return parts.join(" ")
}
