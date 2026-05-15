import { Command, Flags } from "@oclif/core"
import { existsSync, readFileSync, writeFileSync, chmodSync, mkdirSync } from "fs"
import { join, isAbsolute } from "path"
import { getGitHooksDir, isGitRepo, formatMarkdownTable } from "../../shared"
import {
  agentFlag,
  confirmFlag,
  fieldsFlag,
  parseFields,
  renderAgentDryRun,
  renderAgentError,
  renderAgentSuccess,
} from "../../lib/agent"

const DEFAULT_HOOKS_FIELDS = ["hook", "action", "path"] as const

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

interface HookPlan {
  hook: string
  action: "install" | "skip-existing" | "append" | "overwrite"
  path: string
}

export default class HooksInstall extends Command {
  static description = "Install git hooks for YDI (post-checkout, post-merge)"

  static flags = {
    force: Flags.boolean({
      description: "Overwrite existing hooks",
      default: false,
    }),
    agent: agentFlag,
    confirm: confirmFlag,
    fields: fieldsFlag,
  }

  async run(): Promise<void> {
    const { flags } = await this.parse(HooksInstall)
    const startedAt = Date.now()
    const command = `ydi hooks install${flags.force ? " --force" : ""}${flags.agent ? " --agent" : ""}`

    if (!isGitRepo()) {
      return this.failVal(flags.agent, command, "Not in a git repository.", startedAt)
    }

    const hooksDir = getGitHooksDir()
    if (!hooksDir) {
      return this.failVal(flags.agent, command, "Could not determine git hooks directory.", startedAt)
    }

    const resolvedDir = isAbsolute(hooksDir) ? hooksDir : join(process.cwd(), hooksDir)

    const plan: HookPlan[] = []
    for (const hookName of Object.keys(HOOKS)) {
      const hookPath = join(resolvedDir, hookName)
      let action: HookPlan["action"]
      if (existsSync(hookPath) && !flags.force) {
        const existing = readFileSync(hookPath, "utf8")
        if (existing.includes("# ydi-hook")) {
          action = "skip-existing"
        } else {
          action = "append"
        }
      } else {
        action = existsSync(hookPath) ? "overwrite" : "install"
      }
      plan.push({ hook: hookName, action, path: hookPath })
    }

    if (flags.agent && !flags.confirm) {
      const fields = parseFields(flags.fields) ?? [...DEFAULT_HOOKS_FIELDS]
      this.log(
        renderAgentDryRun({
          command,
          statusSummary: `Would update ${plan.filter((p) => p.action !== "skip-existing").length} hook(s)`,
          result: formatMarkdownTable(plan as unknown as Record<string, unknown>[], fields),
          confirmCommand: `${command} --confirm`,
          startedAt,
          meta: { dir: `dir: ${resolvedDir}` },
        }),
      )
      return
    }

    try {
      mkdirSync(resolvedDir, { recursive: true })

      for (const item of plan) {
        const hookContent = HOOKS[item.hook as keyof typeof HOOKS]
        if (item.action === "skip-existing") {
          if (!flags.agent) {
            this.log(`${item.hook}: already installed (use --force to overwrite)`)
          }
          continue
        }
        if (item.action === "append") {
          const existing = readFileSync(item.path, "utf8")
          const appended = existing.trimEnd() + "\n\n" + hookContent.split("\n").slice(1).join("\n")
          writeFileSync(item.path, appended)
          chmodSync(item.path, 0o755)
          if (!flags.agent) {
            this.log(`${item.hook}: appended to existing hook`)
          }
          continue
        }
        writeFileSync(item.path, hookContent)
        chmodSync(item.path, 0o755)
        if (!flags.agent) {
          this.log(`${item.hook}: ${item.action === "overwrite" ? "overwritten" : "installed"}`)
        }
      }

      if (flags.agent) {
        const fields = parseFields(flags.fields) ?? [...DEFAULT_HOOKS_FIELDS]
        this.log(
          renderAgentSuccess({
            command,
            statusSummary: `Installed ${plan.filter((p) => p.action !== "skip-existing").length} hook(s)`,
            result: formatMarkdownTable(plan as unknown as Record<string, unknown>[], fields),
            actions: [`Verify: \`ydi hooks status --agent\``],
            startedAt,
            meta: { dir: `dir: ${resolvedDir}` },
          }),
        )
      }
    } catch (err) {
      if (flags.agent) {
        const { output, exitCode } = renderAgentError(command, err, startedAt)
        this.log(output)
        this.exit(exitCode)
      }
      this.error(err instanceof Error ? err.message : String(err))
    }
  }

  private failVal(agent: boolean, command: string, message: string, startedAt: number): never {
    if (agent) {
      const { output, exitCode } = renderAgentError(command, new Error(message), startedAt)
      this.log(output)
      this.exit(exitCode)
    }
    this.error(message)
  }
}
