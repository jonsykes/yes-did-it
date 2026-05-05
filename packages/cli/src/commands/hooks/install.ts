import { Command, Flags } from "@oclif/core"
import { existsSync, readFileSync, writeFileSync, chmodSync, mkdirSync } from "fs"
import { join, isAbsolute } from "path"
import { getGitHooksDir, isGitRepo } from "../../shared"

const HOOKS = {
  "post-checkout": `#!/bin/sh
# ydi-hook: post-checkout — show todos for the new branch after switching
# Installed by: ydi hooks install

# Only run on branch switch (flag=1), not file checkout
if [ "$3" = "1" ]; then
  BRANCH=$(git rev-parse --abbrev-ref HEAD)
  echo ""
  echo "YDI todos on branch: $BRANCH"
  ydi list --branch "$BRANCH" 2>/dev/null || true
fi
`,
  "post-merge": `#!/bin/sh
# ydi-hook: post-merge — prompt to complete branch todos after merge
# Installed by: ydi hooks install

BRANCH=$(git rev-parse --abbrev-ref HEAD)
echo ""
echo "Merge complete on $BRANCH."
echo "Run 'ydi sweep' to clean up stale todos."
`,
}

export default class HooksInstall extends Command {
  static description = "Install git hooks for YDI (post-checkout, post-merge)"

  static flags = {
    force: Flags.boolean({
      description: "Overwrite existing hooks",
      default: false,
    }),
  }

  async run(): Promise<void> {
    const { flags } = await this.parse(HooksInstall)

    if (!isGitRepo()) {
      this.error("Not in a git repository.")
    }

    const hooksDir = getGitHooksDir()
    if (!hooksDir) {
      this.error("Could not determine git hooks directory.")
    }

    const resolvedDir = isAbsolute(hooksDir) ? hooksDir : join(process.cwd(), hooksDir)
    mkdirSync(resolvedDir, { recursive: true })

    for (const [hookName, hookContent] of Object.entries(HOOKS)) {
      const hookPath = join(resolvedDir, hookName)

      if (existsSync(hookPath) && !flags.force) {
        const existing = readFileSync(hookPath, "utf8")
        if (existing.includes("# ydi-hook")) {
          this.log(`${hookName}: already installed (use --force to overwrite)`)
          continue
        }
        // Append to existing hook
        const appended = existing.trimEnd() + "\n\n" + hookContent.split("\n").slice(1).join("\n")
        writeFileSync(hookPath, appended)
        chmodSync(hookPath, 0o755)
        this.log(`${hookName}: appended to existing hook`)
        continue
      }

      writeFileSync(hookPath, hookContent)
      chmodSync(hookPath, 0o755)
      this.log(`${hookName}: installed`)
    }
  }
}
