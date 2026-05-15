import { Command } from "@oclif/core"
import { existsSync, readFileSync, writeFileSync, unlinkSync } from "fs"
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

const HOOK_NAMES = ["post-checkout", "post-merge"]
const DEFAULT_HOOKS_FIELDS = ["hook", "action", "path"] as const

interface HookPlan {
  hook: string
  action: "remove" | "strip-section" | "skip-not-found" | "skip-not-ydi"
  path: string
}

export default class HooksUninstall extends Command {
  static description = "Remove YDI git hooks"

  static flags = {
    agent: agentFlag,
    confirm: confirmFlag,
    fields: fieldsFlag,
  }

  async run(): Promise<void> {
    const { flags } = await this.parse(HooksUninstall)
    const startedAt = Date.now()
    const command = `ydi hooks uninstall${flags.agent ? " --agent" : ""}`

    if (!isGitRepo()) {
      return this.failVal(flags.agent, command, "Not in a git repository.", startedAt)
    }

    const hooksDir = getGitHooksDir()
    if (!hooksDir) {
      return this.failVal(flags.agent, command, "Could not determine git hooks directory.", startedAt)
    }

    const resolvedDir = isAbsolute(hooksDir) ? hooksDir : join(process.cwd(), hooksDir)

    const plan: HookPlan[] = []
    for (const hookName of HOOK_NAMES) {
      const hookPath = join(resolvedDir, hookName)
      if (!existsSync(hookPath)) {
        plan.push({ hook: hookName, action: "skip-not-found", path: hookPath })
        continue
      }
      const content = readFileSync(hookPath, "utf8")
      if (!content.includes("# ydi-hook")) {
        plan.push({ hook: hookName, action: "skip-not-ydi", path: hookPath })
        continue
      }
      const lines = content.split("\n")
      const ydiStart = lines.findIndex((l) => l.includes("# ydi-hook"))
      const beforeYdi = lines.slice(0, ydiStart).join("\n").trim()
      if (!beforeYdi || beforeYdi === "#!/bin/sh") {
        plan.push({ hook: hookName, action: "remove", path: hookPath })
      } else {
        plan.push({ hook: hookName, action: "strip-section", path: hookPath })
      }
    }

    if (flags.agent && !flags.confirm) {
      const fields = parseFields(flags.fields) ?? [...DEFAULT_HOOKS_FIELDS]
      const changes = plan.filter((p) => p.action === "remove" || p.action === "strip-section").length
      this.log(
        renderAgentDryRun({
          command,
          statusSummary: `Would update ${changes} hook(s)`,
          result: formatMarkdownTable(plan as unknown as Record<string, unknown>[], fields),
          confirmCommand: `${command} --confirm`,
          startedAt,
          meta: { dir: `dir: ${resolvedDir}` },
        }),
      )
      return
    }

    try {
      for (const item of plan) {
        if (item.action === "skip-not-found") {
          if (!flags.agent) this.log(`${item.hook}: not found`)
          continue
        }
        if (item.action === "skip-not-ydi") {
          if (!flags.agent) this.log(`${item.hook}: not a YDI hook, skipping`)
          continue
        }
        if (item.action === "remove") {
          unlinkSync(item.path)
          if (!flags.agent) this.log(`${item.hook}: removed`)
          continue
        }
        // strip-section
        const content = readFileSync(item.path, "utf8")
        const lines = content.split("\n")
        const ydiStart = lines.findIndex((l) => l.includes("# ydi-hook"))
        const beforeYdi = lines.slice(0, ydiStart).join("\n").trim()
        writeFileSync(item.path, beforeYdi + "\n")
        if (!flags.agent) this.log(`${item.hook}: YDI section removed (other hook content preserved)`)
      }

      if (flags.agent) {
        const fields = parseFields(flags.fields) ?? [...DEFAULT_HOOKS_FIELDS]
        const changes = plan.filter((p) => p.action === "remove" || p.action === "strip-section").length
        this.log(
          renderAgentSuccess({
            command,
            statusSummary: `Updated ${changes} hook(s)`,
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
