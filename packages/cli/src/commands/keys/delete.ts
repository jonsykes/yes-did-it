import { Command, Args } from "@oclif/core"
import { listApiKeys, deleteApiKey } from "../../lib/api-client"

export default class KeysDelete extends Command {
  static description = "Delete an API key"

  static args = {
    id: Args.string({ required: true, description: "Key ID" }),
  }

  async run(): Promise<void> {
    const { args } = await this.parse(KeysDelete)

    try {
      // Accept prefix match on key ID
      if (args.id.length < 36) {
        const keys = await listApiKeys()
        const matches = keys.filter((k) => k.id.startsWith(args.id))
        if (matches.length === 0) this.error(`No key found matching "${args.id}"`)
        if (matches.length > 1) this.error(`Ambiguous — ${matches.length} keys match. Use more characters.`)
        args.id = matches[0].id
      }

      await deleteApiKey(args.id)
      this.log(`Deleted key: ${args.id.slice(0, 8)}`)
    } catch (err) {
      this.error(err instanceof Error ? err.message : String(err))
    }
  }
}
