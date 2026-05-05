import { Command, Args } from "@oclif/core"
import { isValidKey, getSetting, isExplicitlySet } from "../../lib/settings"

export default class ConfigGet extends Command {
  static description = "Get a configuration value"

  static args = {
    key: Args.string({ required: true, description: "Setting key (e.g. timezone, color)" }),
  }

  async run(): Promise<void> {
    const { args } = await this.parse(ConfigGet)

    if (!isValidKey(args.key)) {
      this.error(`Unknown setting: "${args.key}". Run "ydi config list" to see all settings.`)
    }

    const value = getSetting(args.key)
    const suffix = isExplicitlySet(args.key) ? "" : " (default)"
    this.log(`${args.key} = ${value}${suffix}`)
  }
}
