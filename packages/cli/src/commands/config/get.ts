import { Command, Args, Flags } from "@oclif/core"
import { isValidKey, getSetting, isExplicitlySet } from "../../lib/settings"
import { formatKeyValue } from "../../shared"
import {
  agentFlag,
  renderAgentError,
  renderAgentSuccess,
} from "../../lib/agent"

export default class ConfigGet extends Command {
  static description = "Get a configuration value"

  static args = {
    key: Args.string({ required: true, description: "Setting key (e.g. timezone, color)" }),
  }

  static flags = {
    agent: agentFlag,
  }

  async run(): Promise<void> {
    const { args, flags } = await this.parse(ConfigGet)
    const startedAt = Date.now()
    const command = `ydi config get ${args.key}${flags.agent ? " --agent" : ""}`

    if (!isValidKey(args.key)) {
      const message = `Unknown setting: "${args.key}". Run "ydi config list" to see all settings.`
      if (flags.agent) {
        const { output, exitCode } = renderAgentError(
          command,
          new Error(message),
          startedAt,
        )
        this.log(output)
        this.exit(exitCode)
      }
      this.error(message)
    }

    const value = getSetting(args.key)
    const source = isExplicitlySet(args.key) ? "user" : "default"

    if (flags.agent) {
      this.log(
        renderAgentSuccess({
          command,
          statusSummary: `${args.key} = ${value} (${source})`,
          result: formatKeyValue({
            key: args.key,
            value: String(value),
            source,
          }),
          actions: [
            "List all settings: `ydi config list --agent`",
            `Update this setting: \`ydi config set ${args.key} <value> --agent\``,
          ],
          startedAt,
        }),
      )
      return
    }

    const suffix = source === "default" ? " (default)" : ""
    this.log(`${args.key} = ${value}${suffix}`)
  }
}
