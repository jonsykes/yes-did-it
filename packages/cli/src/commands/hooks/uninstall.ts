import { Command } from "@oclif/core"
import { existsSync, readFileSync, writeFileSync, unlinkSync } from "fs"
import { join, isAbsolute } from "path"
import { getGitHooksDir, isGitRepo } from "../../shared"

const HOOK_NAMES = ["post-checkout", "post-merge"]

export default class HooksUninstall extends Command {
  static description = "Remove YDI git hooks"

  async run(): Promise<void> {
    if (!isGitRepo()) {
      this.error("Not in a git repository.")
    }

    const hooksDir = getGitHooksDir()
    if (!hooksDir) {
      this.error("Could not determine git hooks directory.")
    }

    const resolvedDir = isAbsolute(hooksDir) ? hooksDir : join(process.cwd(), hooksDir)

    for (const hookName of HOOK_NAMES) {
      const hookPath = join(resolvedDir, hookName)

      if (!existsSync(hookPath)) {
        this.log(`${hookName}: not found`)
        continue
      }

      const content = readFileSync(hookPath, "utf8")
      if (!content.includes("# ydi-hook")) {
        this.log(`${hookName}: not a YDI hook, skipping`)
        continue
      }

      // If the entire file is a YDI hook (starts with #!/bin/sh and # ydi-hook), remove it
      // Otherwise strip just the YDI section
      const lines = content.split("\n")
      const ydiStart = lines.findIndex((l) => l.includes("# ydi-hook"))
      const beforeYdi = lines.slice(0, ydiStart).join("\n").trim()

      if (!beforeYdi || beforeYdi === "#!/bin/sh") {
        unlinkSync(hookPath)
        this.log(`${hookName}: removed`)
      } else {
        // Strip from ydi-hook marker to end of YDI section
        writeFileSync(hookPath, beforeYdi + "\n")
        this.log(`${hookName}: YDI section removed (other hook content preserved)`)
      }
    }
  }
}
