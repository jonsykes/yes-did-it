import { Command } from "@oclif/core"
import { getDefaults, readSettings, isExplicitlySet, type SettingKey } from "../../lib/settings"

export default class ConfigList extends Command {
  static description = "List all configuration settings"

  async run(): Promise<void> {
    const settings = readSettings()
    const defaults = getDefaults()

    const keys = Object.keys(defaults) as SettingKey[]
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
