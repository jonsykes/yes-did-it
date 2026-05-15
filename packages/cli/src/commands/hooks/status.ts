import { Command } from "@oclif/core"
import { isGitRepo, isHookInstalled, formatKeyValue } from "../../shared"
import {
  agentFlag,
  renderAgentError,
  renderAgentSuccess,
} from "../../lib/agent"

const HOOK_NAMES = ["post-checkout", "post-merge"]

export default class HooksStatus extends Command {
  static description = "Show which YDI git hooks are installed"

  static flags = {
    agent: agentFlag,
  }

  async run(): Promise<void> {
    const { flags } = await this.parse(HooksStatus)
    const startedAt = Date.now()
    const command = `ydi hooks status${flags.agent ? " --agent" : ""}`

    if (!isGitRepo()) {
      const message = "Not in a git repository."
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

    const status: Record<string, string> = {}
    let anyInstalled = false
    for (const hookName of HOOK_NAMES) {
      const installed = isHookInstalled(hookName)
      status[hookName] = installed ? "installed" : "not installed"
      if (installed) anyInstalled = true
    }

    if (flags.agent) {
      const summary = anyInstalled
        ? `${HOOK_NAMES.filter((h) => status[h] === "installed").length} of ${HOOK_NAMES.length} hooks installed`
        : "no hooks installed"
      const actions = anyInstalled
        ? ["Reinstall hooks (dry-run): `ydi hooks install --dry-run --agent`", "Uninstall hooks (dry-run): `ydi hooks uninstall --dry-run --agent`"]
        : ["Install hooks (dry-run): `ydi hooks install --dry-run --agent`"]

      this.log(
        renderAgentSuccess({
          command,
          statusSummary: summary,
          result: formatKeyValue(status),
          actions,
          startedAt,
        }),
      )
      return
    }

    for (const hookName of HOOK_NAMES) {
      this.log(`${hookName}: ${status[hookName]}`)
    }

    if (!anyInstalled) {
      this.log("")
      this.log("No YDI hooks installed. Run: ydi hooks install")
    }
  }
}
