import { Command, Flags } from "@oclif/core"
import * as chrono from "chrono-node"
import { createApiKey } from "../../lib/api-client"

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
  }

  async run(): Promise<void> {
    const { flags } = await this.parse(KeysCreate)

    let expires_at: string | undefined
    if (flags.expires) {
      const parsed = chrono.parseDate(flags.expires)
      if (!parsed) {
        this.error(`Could not parse expiry date: "${flags.expires}"`)
      }
      expires_at = parsed.toISOString()
    }

    try {
      const apiKey = await createApiKey({ name: flags.name, expires_at })

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
      this.error(err instanceof Error ? err.message : String(err))
    }
  }
}
