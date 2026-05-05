import { Command, Args } from "@oclif/core"
import { validateSetting, setSetting } from "../../lib/settings"

export default class ConfigSet extends Command {
  static description = "Set a configuration value"

  static args = {
    key: Args.string({ required: true, description: "Setting key (e.g. timezone, color)" }),
    value: Args.string({ required: true, description: "Setting value" }),
  }

  async run(): Promise<void> {
    const { args } = await this.parse(ConfigSet)

    try {
      const { key, parsed } = validateSetting(args.key, args.value)
      setSetting(key, parsed)
      this.log(`Set ${key} = ${parsed}`)
    } catch (err) {
      this.error(err instanceof Error ? err.message : String(err))
    }
  }
}
