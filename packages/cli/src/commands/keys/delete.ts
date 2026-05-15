import { Command, Args, Flags } from "@oclif/core"
import { listApiKeys, deleteApiKey, type ApiKey } from "../../lib/api-client"
import { formatKeyValue } from "../../shared"
import {
  agentFlag,
  confirmFlag,
  fieldsFlag,
  parseFields,
  renderAgentDryRun,
  renderAgentError,
  renderAgentSuccess,
} from "../../lib/agent"

const DEFAULT_KEY_FIELDS = ["id", "name", "key_prefix"] as const

export default class KeysDelete extends Command {
  static description = "Delete an API key"

  static args = {
    id: Args.string({ required: true, description: "Key ID" }),
  }

  static flags = {
    agent: agentFlag,
    confirm: confirmFlag,
    fields: fieldsFlag,
  }

  async run(): Promise<void> {
    const { args, flags } = await this.parse(KeysDelete)
    const startedAt = Date.now()
    const command = buildKeysDeleteCommand(args.id, flags)

    try {
      let target: ApiKey | undefined
      if (args.id.length < 36) {
        const keys = await listApiKeys()
        const matches = keys.filter((k) => k.id.startsWith(args.id))
        if (matches.length === 0) {
          return this.failVal(flags.agent, command, `No key found matching "${args.id}"`, startedAt)
        }
        if (matches.length > 1) {
          return this.failVal(
            flags.agent,
            command,
            `Ambiguous — ${matches.length} keys match. Use more characters.`,
            startedAt,
          )
        }
        args.id = matches[0].id
        target = matches[0]
      } else if (flags.agent) {
        const keys = await listApiKeys()
        target = keys.find((k) => k.id === args.id)
      }

      if (flags.agent && !flags.confirm) {
        const fields = parseFields(flags.fields) ?? [...DEFAULT_KEY_FIELDS]
        const preview: Record<string, unknown> = target
          ? {
              id: target.id.slice(0, 8),
              name: target.name,
              key_prefix: target.key_prefix,
            }
          : { id: args.id.slice(0, 8) }
        this.log(
          renderAgentDryRun({
            command,
            statusSummary: "Would delete 1 API key",
            result: formatKeyValue(preview, fields),
            confirmCommand: `${command} --confirm`,
            warnings: ["Delete is permanent. Any process using this key will be locked out."],
            startedAt,
          }),
        )
        return
      }

      await deleteApiKey(args.id)

      if (flags.agent) {
        const fields = parseFields(flags.fields) ?? [...DEFAULT_KEY_FIELDS]
        const row: Record<string, unknown> = target
          ? { id: target.id.slice(0, 8), name: target.name, key_prefix: target.key_prefix }
          : { id: args.id.slice(0, 8) }
        this.log(
          renderAgentSuccess({
            command,
            statusSummary: "Deleted 1 API key",
            result: formatKeyValue(row, fields),
            actions: [`List keys: \`ydi keys list --agent\``],
            startedAt,
          }),
        )
        return
      }

      this.log(`Deleted key: ${args.id.slice(0, 8)}`)
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

function buildKeysDeleteCommand(id: string, flags: Record<string, unknown>): string {
  const parts = ["ydi keys delete", id]
  if (flags.agent) parts.push("--agent")
  if (flags.fields) parts.push(`--fields ${flags.fields}`)
  return parts.join(" ")
}
