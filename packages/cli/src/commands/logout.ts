import { Command } from "@oclif/core"
import { readConfig, clearConfig } from "../lib/config"
import {
  agentFlag,
  renderAgentSuccess,
} from "../lib/agent"

export default class Logout extends Command {
  static description = "Log out and clear stored credentials"

  static flags = {
    agent: agentFlag,
  }

  async run(): Promise<void> {
    const { flags } = await this.parse(Logout)
    const startedAt = Date.now()
    const command = `ydi logout${flags.agent ? " --agent" : ""}`

    const config = readConfig()
    if (!config) {
      if (flags.agent) {
        this.log(
          renderAgentSuccess({
            command,
            statusSummary: "Not logged in — no-op",
            result: "Nothing to clear.",
            startedAt,
          }),
        )
        return
      }
      this.log("Not logged in.")
      return
    }

    try {
      await fetch("https://api.yesdidit.com/api/auth/logout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ refresh_token: config.refresh_token }),
      })
    } catch {
      // ignore — local clear still happens
    }

    clearConfig()

    if (flags.agent) {
      this.log(
        renderAgentSuccess({
          command,
          statusSummary: "Logged out and cleared local credentials",
          result: "Local credentials cleared.",
          actions: [`Log back in: \`ydi login\``],
          startedAt,
        }),
      )
      return
    }

    this.log("Logged out.")
  }
}
