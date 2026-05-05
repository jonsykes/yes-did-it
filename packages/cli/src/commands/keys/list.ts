import { Command, Flags } from "@oclif/core"
import { listApiKeys } from "../../lib/api-client"

export default class KeysList extends Command {
  static description = "List API keys"

  static flags = {
    json: Flags.boolean({
      description: "Output as JSON",
      default: false,
    }),
  }

  async run(): Promise<void> {
    const { flags } = await this.parse(KeysList)

    try {
      const keys = await listApiKeys()

      if (flags.json) {
        this.log(JSON.stringify(keys, null, 2))
        return
      }

      if (keys.length === 0) {
        this.log("No API keys. Create one with: ydi keys create --name \"my key\"")
        return
      }

      // Column widths
      const nameW = Math.max(4, ...keys.map((k) => k.name.length))
      const prefixW = 20

      const header =
        "NAME".padEnd(nameW) + "  " +
        "PREFIX".padEnd(prefixW) + "  " +
        "LAST USED".padEnd(18) + "  " +
        "CREATED"
      this.log(header)
      this.log("─".repeat(header.length))

      for (const key of keys) {
        const lastUsed = key.last_used_at
          ? timeAgo(new Date(key.last_used_at))
          : "never"
        const created = new Date(key.created_at).toLocaleDateString("en-US", {
          month: "short",
          day: "numeric",
          year: "numeric",
        })
        this.log(
          key.name.padEnd(nameW) + "  " +
          key.key_prefix.padEnd(prefixW) + "  " +
          lastUsed.padEnd(18) + "  " +
          created
        )
      }
    } catch (err) {
      this.error(err instanceof Error ? err.message : String(err))
    }
  }
}

function timeAgo(date: Date): string {
  const seconds = Math.floor((Date.now() - date.getTime()) / 1000)
  if (seconds < 60) return "just now"
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  if (days < 30) return `${days}d ago`
  const months = Math.floor(days / 30)
  return `${months}mo ago`
}
