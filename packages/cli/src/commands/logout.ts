import { Command } from "@oclif/core"
import { readConfig, clearConfig } from "../lib/config"

export default class Logout extends Command {
  static description = "Log out and clear stored credentials"

  async run(): Promise<void> {
    const config = readConfig()
    if (!config) {
      this.log("Not logged in.")
      return
    }

    // Best-effort server-side revocation — don't block on failure
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
    this.log("Logged out.")
  }
}
