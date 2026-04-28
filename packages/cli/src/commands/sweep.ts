import { Command, Flags } from "@oclif/core"
import { listTodos, bulkDone, type Todo } from "../lib/api-client"
import { getAllRemoteBranches } from "../shared"

type BranchTodo = Todo & { context: NonNullable<Todo["context"]> & { branch: string } }

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
  }

  async run(): Promise<void> {
    const { flags } = await this.parse(Sweep)

    try {
      // Fetch all pending todos with context
      const todos = await listTodos({ status: "pending", limit: 200, has_context: true })

      // Collect unique branches from todos
      const todosWithBranch = todos.filter(
        (t): t is BranchTodo => !!t.context?.branch
      )

      if (todosWithBranch.length === 0) {
        if (flags.json) {
          this.log(JSON.stringify({ stale: [], active: [], noBranch: [] }))
        } else {
          this.log("No todos with branch context found.")
        }
        return
      }

      // Single batch call to get all remote branches
      const remoteBranches = getAllRemoteBranches()

      // Classify todos
      const stale: BranchTodo[] = []
      const active: BranchTodo[] = []
      const noBranch = todos.filter((t) => !t.context?.branch)

      for (const todo of todosWithBranch) {
        if (remoteBranches.size === 0) {
          // Could not reach remote — treat all as unknown (not stale)
          active.push(todo)
        } else if (remoteBranches.has(todo.context.branch)) {
          active.push(todo)
        } else {
          stale.push(todo)
        }
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

      // Interactive: let user select which to complete
      await this.interactiveSelect(stale)
    } catch (err) {
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

    // Map selected labels back to IDs
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
