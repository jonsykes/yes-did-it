import { Command, Args, Flags } from "@oclif/core"
import { deleteTodo, findTodoByIdOrPrefix } from "../lib/api-client"
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

const DEFAULT_DELETE_FIELDS = ["id", "text", "status"] as const

export default class Delete extends Command {
  static description = "Delete a todo"

  static args = {
    id: Args.string({ required: false, description: "Todo ID or prefix (omit to pick interactively)" }),
  }

  static flags = {
    agent: agentFlag,
    confirm: confirmFlag,
    fields: fieldsFlag,
  }

  async run(): Promise<void> {
    const { args, flags } = await this.parse(Delete)
    const startedAt = Date.now()
    const command = buildDeleteCommand(args.id, flags)

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
        const fields = parseFields(flags.fields) ?? [...DEFAULT_DELETE_FIELDS]
        const preview: Record<string, unknown> = {
          id: todo.id.slice(0, 8),
          text: todo.text,
          status: todo.status,
        }
        this.log(
          renderAgentDryRun({
            command,
            statusSummary: "Would delete 1 todo",
            result: formatKeyValue(preview, fields),
            confirmCommand: `${command} --confirm`,
            warnings: ["Delete is permanent — there is no undo."],
            startedAt,
            meta: { id: `id: ${todo.id}` },
          }),
        )
        return
      }

      const id = args.id ?? (await pickTodo({ message: "Delete:", status: "all" }))

      // Capture id details for agent envelope before delete
      const target = flags.agent ? await findTodoByIdOrPrefix(id) : null

      await deleteTodo(id)

      if (flags.agent && target) {
        const fields = parseFields(flags.fields) ?? [...DEFAULT_DELETE_FIELDS]
        const row: Record<string, unknown> = {
          id: target.id.slice(0, 8),
          text: target.text,
          status: target.status,
        }
        this.log(
          renderAgentSuccess({
            command,
            statusSummary: "Deleted 1 todo",
            result: formatKeyValue(row, fields),
            actions: [`Verify removal: \`ydi list --all --agent\``],
            startedAt,
            meta: { id: `id: ${target.id}` },
          }),
        )
        return
      }

      this.log(`Deleted: ${id.slice(0, 8)}`)
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

function buildDeleteCommand(id: string | undefined, flags: Record<string, unknown>): string {
  const parts = ["ydi delete"]
  if (id) parts.push(id)
  if (flags.agent) parts.push("--agent")
  if (flags.fields) parts.push(`--fields ${flags.fields}`)
  return parts.join(" ")
}
