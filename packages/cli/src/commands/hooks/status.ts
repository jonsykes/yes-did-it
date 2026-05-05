import { Command } from "@oclif/core"
import { isGitRepo, isHookInstalled } from "../../shared"

const HOOK_NAMES = ["post-checkout", "post-merge"]

export default class HooksStatus extends Command {
  static description = "Show which YDI git hooks are installed"

  async run(): Promise<void> {
    if (!isGitRepo()) {
      this.error("Not in a git repository.")
    }

    let anyInstalled = false
    for (const hookName of HOOK_NAMES) {
      const installed = isHookInstalled(hookName)
      const status = installed ? "installed" : "not installed"
      this.log(`${hookName}: ${status}`)
      if (installed) anyInstalled = true
    }

    if (!anyInstalled) {
      this.log("")
      this.log("No YDI hooks installed. Run: ydi hooks install")
    }
  }
}
