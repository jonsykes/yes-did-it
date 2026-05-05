import { Command, Args, Flags } from "@oclif/core"
import * as chrono from "chrono-node"
import { updateTodo } from "../lib/api-client"
import { pickTodo } from "../lib/picker"

export default class Update extends Command {
  static description = "Update a todo's text, due date, or tags"

  static args = {
    id: Args.string({ required: false, description: "Todo ID or prefix (omit to pick interactively)" }),
  }

  static flags = {
    text: Flags.string({
      description: "New todo text",
    }),
    due: Flags.string({
      char: "d",
      description: 'New due date/time, e.g. "today 3pm", "tomorrow 9am", "2026-04-01T17:00:00Z"',
    }),
    "clear-due": Flags.boolean({
      description: "Remove the due date",
      default: false,
    }),
    tag: Flags.string({
      char: "t",
      description: "Tag (can be used multiple times, replaces existing tags)",
      multiple: true,
    }),
    "clear-tags": Flags.boolean({
      description: "Remove all tags",
      default: false,
    }),
    json: Flags.boolean({
      description: "Output as JSON",
      default: false,
    }),
  }

  async run(): Promise<void> {
    const { args, flags } = await this.parse(Update)

    if (flags.text === undefined && !flags.due && !flags["clear-due"] && !flags.tag && !flags["clear-tags"]) {
      this.error("Provide at least one of --text, --due, --clear-due, --tag, or --clear-tags")
    }

    if (flags["clear-due"] && flags.due) {
      this.error("Cannot use --due and --clear-due together")
    }

    try {
      const id = args.id ?? (await pickTodo({ message: "Update:", status: "all" }))

      const body: { text?: string; due_at?: string | null; tags?: string[] } = {}

      if (flags.text !== undefined) {
        body.text = flags.text
      }

      if (flags["clear-due"]) {
        body.due_at = null
      } else if (flags.due) {
        const parsed = chrono.parseDate(flags.due)
        if (!parsed) {
          this.error(`Could not parse due date: "${flags.due}"`)
        }
        body.due_at = parsed.toISOString()
      }

      if (flags["clear-tags"]) {
        body.tags = []
      } else if (flags.tag) {
        body.tags = flags.tag
      }

      const todo = await updateTodo(id, body)

      if (flags.json) {
        this.log(JSON.stringify(todo, null, 2))
        return
      }

      this.log(`Updated: ${todo.id.slice(0, 8)}  ${todo.text}`)
      if (todo.due_at) {
        this.log(`  Due: ${formatDate(todo.due_at)}`)
      }
      if (todo.tags.length > 0) {
        this.log(`  Tags: ${todo.tags.join(", ")}`)
      }
    } catch (err) {
      this.error(err instanceof Error ? err.message : String(err))
    }
  }
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  })
}
