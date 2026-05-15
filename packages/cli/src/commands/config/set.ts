import { Command, Args, Flags } from "@oclif/core"
import { validateSetting, setSetting, getSetting } from "../../lib/settings"
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

const DEFAULT_CONFIG_FIELDS = ["key", "value", "previous"] as const

export default class ConfigSet extends Command {
  static description = "Set a configuration value"

  static args = {
    key: Args.string({ required: true, description: "Setting key (e.g. timezone, color)" }),
    value: Args.string({ required: true, description: "Setting value" }),
  }

  static flags = {
    agent: agentFlag,
    confirm: confirmFlag,
    fields: fieldsFlag,
  }

  async run(): Promise<void> {
    const { args, flags } = await this.parse(ConfigSet)
    const startedAt = Date.now()
    const command = `ydi config set ${args.key} ${JSON.stringify(args.value)}${flags.agent ? " --agent" : ""}`

    try {
      const { key, parsed } = validateSetting(args.key, args.value)
      const previous = getSetting(key)

      if (flags.agent && !flags.confirm) {
        const fields = parseFields(flags.fields) ?? [...DEFAULT_CONFIG_FIELDS]
        const preview: Record<string, unknown> = {
          key,
          value: parsed,
          previous,
        }
        this.log(
          renderAgentDryRun({
            command,
            statusSummary:
              previous === parsed
                ? "Value already matches — would be a no-op"
                : `Would set ${key} = ${parsed}`,
            result: formatKeyValue(preview, fields),
            confirmCommand: `${command} --confirm`,
            startedAt,
          }),
        )
        return
      }

      setSetting(key, parsed)

      if (flags.agent) {
        const fields = parseFields(flags.fields) ?? [...DEFAULT_CONFIG_FIELDS]
        const row: Record<string, unknown> = { key, value: parsed, previous }
        this.log(
          renderAgentSuccess({
            command,
            statusSummary: `Set ${key} = ${parsed}`,
            result: formatKeyValue(row, fields),
            actions: [`Verify: \`ydi config get ${key} --agent\``],
            startedAt,
          }),
        )
        return
      }

      this.log(`Set ${key} = ${parsed}`)
    } catch (err) {
      if (flags.agent) {
        const { output, exitCode } = renderAgentError(command, err, startedAt)
        this.log(output)
        this.exit(exitCode)
      }
      this.error(err instanceof Error ? err.message : String(err))
    }
  }
}
