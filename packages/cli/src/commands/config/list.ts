import { Command, Flags } from "@oclif/core"
import { getDefaults, readSettings, isExplicitlySet, type SettingKey } from "../../lib/settings"
import { formatMarkdownTable } from "../../shared"
import {
  agentFlag,
  fieldsFlag,
  parseFields,
  renderAgentSuccess,
} from "../../lib/agent"

export default class ConfigList extends Command {
  static description = "List all configuration settings"

  static flags = {
    agent: agentFlag,
    fields: fieldsFlag,
  }

  async run(): Promise<void> {
    const { flags } = await this.parse(ConfigList)
    const startedAt = Date.now()
    const command = `ydi config list${flags.agent ? " --agent" : ""}`

    const settings = readSettings()
    const defaults = getDefaults()

    const keys = Object.keys(defaults) as SettingKey[]

    if (flags.agent) {
      const rows = keys.map((key) => ({
        key,
        value: String(settings[key]),
        source: isExplicitlySet(key) ? "user" : "default",
      }))
      const fields = parseFields(flags.fields) ?? ["key", "value", "source"]
      this.log(
        renderAgentSuccess({
          command,
          statusSummary: `${rows.length} settings`,
          result: formatMarkdownTable(rows, fields),
          actions: [
            "Show one setting: `ydi config get <key> --agent`",
            "Change a setting: `ydi config set <key> <value> --agent`",
          ],
          startedAt,
        }),
      )
      return
    }

    const maxKeyLen = Math.max(...keys.map((k) => k.length))

    this.log("Settings:")
    this.log("")
    for (const key of keys) {
      const value = settings[key]
      const source = isExplicitlySet(key) ? "" : " (default)"
      this.log(`  ${key.padEnd(maxKeyLen)}  ${value}${source}`)
    }
  }
}
