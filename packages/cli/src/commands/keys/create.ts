import { Command, Flags } from "@oclif/core"
import * as chrono from "chrono-node"
import { createApiKey } from "../../lib/api-client"
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

const DEFAULT_KEY_FIELDS = ["id", "name", "key_prefix", "expires_at"] as const

export default class KeysCreate extends Command {
  static description = "Create a new API key"

  static flags = {
    name: Flags.string({
      char: "n",
      description: "Name for the key (e.g. \"CI\", \"home server\")",
      required: true,
    }),
    expires: Flags.string({
      char: "e",
      description: 'Expiry date, e.g. "in 90 days", "2027-01-01"',
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
    const { flags } = await this.parse(KeysCreate)
    const startedAt = Date.now()
    const command = buildKeysCreateCommand(flags)

    let expires_at: string | undefined
    if (flags.expires) {
      const parsed = chrono.parseDate(flags.expires)
      if (!parsed) {
        return this.failVal(flags.agent, command, `Could not parse expiry date: "${flags.expires}"`, startedAt)
      }
      expires_at = parsed.toISOString()
    }

    if (flags.agent && !flags.confirm) {
      const fields = parseFields(flags.fields) ?? [...DEFAULT_KEY_FIELDS]
      const preview: Record<string, unknown> = {
        name: flags.name,
        expires_at: expires_at ?? "never",
      }
      this.log(
        renderAgentDryRun({
          command,
          statusSummary: "Would create 1 API key",
          result: formatKeyValue(preview, fields.filter((f) => f !== "id" && f !== "key_prefix")),
          confirmCommand: `${command} --confirm`,
          warnings: ["The key value is shown only once at create time — capture it from the success envelope."],
          startedAt,
        }),
      )
      return
    }

    try {
      const apiKey = await createApiKey({ name: flags.name, expires_at })

      if (flags.agent) {
        const fields = parseFields(flags.fields) ?? [...DEFAULT_KEY_FIELDS]
        const row: Record<string, unknown> = {
          id: apiKey.id.slice(0, 8),
          name: apiKey.name,
          key_prefix: apiKey.key_prefix,
          expires_at: apiKey.expires_at ?? "never",
        }
        this.log(
          renderAgentSuccess({
            command,
            statusSummary: "Created 1 API key",
            result:
              formatKeyValue(row, fields) +
              `\n\n**Key (shown once):** \`${apiKey.key}\``,
            warnings: ["Store the key now — it will not be shown again."],
            actions: [`List keys: \`ydi keys list --agent\``],
            startedAt,
            meta: { id: `id: ${apiKey.id}` },
          }),
        )
        return
      }

      if (flags.json) {
        this.log(JSON.stringify(apiKey, null, 2))
        return
      }

      this.log("")
      this.log("⚠️  Save this key now — it will not be shown again.")
      this.log("")
      this.log(apiKey.key)
      this.log("")
      this.log(`Name:    ${apiKey.name}`)
      this.log(`Prefix:  ${apiKey.key_prefix}`)
      if (apiKey.expires_at) {
        this.log(`Expires: ${new Date(apiKey.expires_at).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}`)
      } else {
        this.log("Expires: never")
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

function buildKeysCreateCommand(flags: Record<string, unknown>): string {
  const parts = ["ydi keys create"]
  if (typeof flags.name === "string") parts.push(`--name ${JSON.stringify(flags.name)}`)
  if (typeof flags.expires === "string") parts.push(`--expires ${JSON.stringify(flags.expires)}`)
  if (flags.agent) parts.push("--agent")
  if (flags.fields) parts.push(`--fields ${flags.fields}`)
  return parts.join(" ")
}
