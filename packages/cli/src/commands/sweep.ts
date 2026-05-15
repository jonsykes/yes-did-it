import { Command, Flags } from "@oclif/core"
import { listTodos, bulkDone, type Todo } from "../lib/api-client"
import { getAllRemoteBranches, formatMarkdownTable } from "../shared"
import {
  agentFlag,
  confirmFlag,
  fieldsFlag,
  parseFields,
  renderAgentDryRun,
  renderAgentError,
  renderAgentSuccess,
} from "../lib/agent"

type BranchTodo = Todo & { context: NonNullable<Todo["context"]> & { branch: string } }

const DEFAULT_SWEEP_FIELDS = ["id", "text", "branch"] as const

export default class Sweep extends Command {
  static description = "Find and complete stale todos (branches deleted on remote)"

  static flags = {
    "dry-run": Flags.boolean({
      description: "List stale todos without marking them done",
      default: false,
    }),
    auto: Flags.boolean({
      description: "Mark all stale todos as done without prompting",
      default: false,
    }),
    json: Flags.boolean({
      description: "Output as JSON",
      default: false,
    }),
    agent: agentFlag,
    confirm: confirmFlag,
    fields: fieldsFlag,
  }

  async run(): Promise<void> {
    const { flags } = await this.parse(Sweep)
    const startedAt = Date.now()
    const command = buildSweepCommand(flags)

    try {
      const todos = await listTodos({ status: "pending", limit: 200, has_context: true })

      const todosWithBranch = todos.filter(
        (t): t is BranchTodo => !!t.context?.branch
      )

      if (todosWithBranch.length === 0) {
        if (flags.agent) {
          this.log(
            renderAgentSuccess({
              command,
              statusSummary: "No todos with branch context found",
              result: "No results.",
              startedAt,
            }),
          )
          return
        }
        if (flags.json) {
          this.log(JSON.stringify({ stale: [], active: [], noBranch: [] }))
        } else {
          this.log("No todos with branch context found.")
        }
        return
      }

      const remoteBranches = getAllRemoteBranches()

      const stale: BranchTodo[] = []
      const active: BranchTodo[] = []
      const noBranch = todos.filter((t) => !t.context?.branch)

      for (const todo of todosWithBranch) {
        if (remoteBranches.size === 0) {
          active.push(todo)
        } else if (remoteBranches.has(todo.context.branch)) {
          active.push(todo)
        } else {
          stale.push(todo)
        }
      }

      if (flags.agent) {
        const fields = parseFields(flags.fields) ?? [...DEFAULT_SWEEP_FIELDS]
        const rows = stale.map((t) => ({
          id: t.id.slice(0, 8),
          text: t.text,
          branch: t.context.branch,
        }))

        if (stale.length === 0) {
          this.log(
            renderAgentSuccess({
              command,
              statusSummary: `0 stale todos (${active.length} active)`,
              result: "No stale todos.",
              startedAt,
            }),
          )
          return
        }

        if (!flags.confirm) {
          const warnings: string[] = []
          if (remoteBranches.size === 0) {
            warnings.push("Could not reach remote — falling back to local branch detection. Results may be incomplete.")
          }
          this.log(
            renderAgentDryRun({
              command,
              statusSummary: `Would mark ${stale.length} stale todo(s) as done`,
              result: formatMarkdownTable(rows, fields),
              confirmCommand: `${command} --confirm`,
              warnings: warnings.length > 0 ? warnings : undefined,
              startedAt,
              meta: { stale: `stale: ${stale.length}`, active: `active: ${active.length}` },
            }),
          )
          return
        }

        const ids = stale.map((t) => t.id)
        const result = await bulkDone(ids)
        const status = result.updated < ids.length ? "partial" : "success"
        this.log(
          renderAgentSuccess({
            command,
            status,
            statusSummary: `Completed ${result.updated} of ${ids.length} stale todo(s)`,
            result: formatMarkdownTable(rows, fields),
            warnings: result.updated < ids.length
              ? [`${ids.length - result.updated} todo(s) failed to update`]
              : undefined,
            actions: [`Verify: \`ydi list --done --agent\``],
            startedAt,
            meta: { updated: `updated: ${result.updated}` },
          }),
        )
        return
      }

      if (flags.json) {
        this.log(JSON.stringify({
          stale: stale.map((t) => ({ id: t.id, text: t.text, branch: t.context.branch })),
          active: active.map((t) => ({ id: t.id, text: t.text, branch: t.context.branch })),
          noBranch: noBranch.map((t) => ({ id: t.id, text: t.text })),
        }, null, 2))
        if (flags["dry-run"] || stale.length === 0) return
      }

      if (stale.length === 0) {
        if (!flags.json) {
          this.log(`No stale todos found. ${active.length} todo(s) on active branches.`)
        }
        return
      }

      if (!flags.json) {
        this.log(`Found ${stale.length} stale todo(s) (branch deleted on remote):\n`)
        const grouped = groupByBranch(stale)
        for (const [branch, todos] of grouped) {
          this.log(`  ${branch}:`)
          for (const todo of todos) {
            this.log(`    · ${todo.id.slice(0, 8)}  ${todo.text}`)
          }
        }
        this.log("")
      }

      if (flags["dry-run"]) {
        if (!flags.json) {
          this.log("Dry run — no changes made.")
        }
        return
      }

      if (flags.auto) {
        await this.markStaleDone(stale)
        return
      }

      await this.interactiveSelect(stale)
    } catch (err) {
      if (flags.agent) {
        const { output, exitCode } = renderAgentError(command, err, startedAt)
        this.log(output)
        this.exit(exitCode)
      }
      this.error(err instanceof Error ? err.message : String(err))
    }
  }

  private async markStaleDone(stale: BranchTodo[]): Promise<void> {
    const ids = stale.map((t) => t.id)
    const result = await bulkDone(ids)
    if (result.updated < ids.length) {
      this.warn(`Completed ${result.updated} of ${ids.length} stale todos (${ids.length - result.updated} failed)`)
    } else {
      this.log(`Completed ${result.updated} stale todo(s).`)
    }
  }

  private async interactiveSelect(stale: BranchTodo[]): Promise<void> {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { MultiSelect } = require("enquirer") as {
      MultiSelect: new (opts: {
        name: string
        message: string
        choices: Array<{ name: string; value: string }>
      }) => { run(): Promise<string[]> }
    }

    const choices = stale.map((t) => ({
      name: `${t.id.slice(0, 8)}  ${t.text}  [${t.context.branch}]`,
      value: t.id,
    }))

    const prompt = new MultiSelect({
      name: "todos",
      message: "Select stale todos to mark as done",
      choices,
    })

    const selected = await prompt.run()
    if (selected.length === 0) {
      this.log("No todos selected.")
      return
    }

    const selectedIds = selected.map((label) => {
      const match = stale.find(
        (t) => `${t.id.slice(0, 8)}  ${t.text}  [${t.context.branch}]` === label
      )
      return match!.id
    })

    const result = await bulkDone(selectedIds)
    this.log(`Completed ${result.updated} todo(s).`)
  }
}

function buildSweepCommand(flags: Record<string, unknown>): string {
  const parts = ["ydi sweep"]
  if (flags.agent) parts.push("--agent")
  if (flags.fields) parts.push(`--fields ${flags.fields}`)
  return parts.join(" ")
}

function groupByBranch(todos: BranchTodo[]): Map<string, BranchTodo[]> {
  const map = new Map<string, BranchTodo[]>()
  for (const todo of todos) {
    const branch = todo.context.branch
    const list = map.get(branch) ?? []
    list.push(todo)
    map.set(branch, list)
  }
  return map
}
