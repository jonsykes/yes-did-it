import { Command, Flags, Args } from "@oclif/core"
import * as chrono from "chrono-node"
import { createTodo } from "../lib/api-client"
import { getGitContext, type GitContext } from "../shared"
import { getSetting } from "../lib/settings"

export default class Add extends Command {
  static description = "Add a new todo"

  static args = {
    text: Args.string({ required: true, description: "Todo text" }),
  }

  static flags = {
    due: Flags.string({
      char: "d",
      description: 'Due date/time, e.g. "today 3pm", "tomorrow 9am", "2026-04-01T17:00:00Z"',
    }),
    tag: Flags.string({
      char: "t",
      description: "Tag (can be used multiple times)",
      multiple: true,
    }),
    json: Flags.boolean({
      description: "Output as JSON",
      default: false,
    }),
    issue: Flags.string({
      char: "i",
      description: 'GitHub issue (e.g. "42" or "owner/repo#42")',
    }),
    pr: Flags.integer({
      description: "GitHub PR number",
    }),
    "no-context": Flags.boolean({
      description: "Disable automatic git context capture",
      default: false,
    }),
  }

  async run(): Promise<void> {
    const { args, flags } = await this.parse(Add)

    let due_at: string | null = null
    if (flags.due) {
      const timezone = getSetting("timezone") as string
      const parsed = chrono.parseDate(flags.due, { timezone })
      if (!parsed) {
        this.error(`Could not parse due date: "${flags.due}"`)
      }
      due_at = parsed.toISOString()
    }

    const autoContext = getSetting("context.auto")
    let context: GitContext | undefined = (flags["no-context"] || !autoContext) ? undefined : getGitContext() ?? undefined

    // Merge issue/PR into context
    if (flags.issue || flags.pr) {
      context = context ?? {}
      if (flags.issue) {
        const parsed = parseIssueRef(flags.issue)
        context.issue = parsed.issue
        if (parsed.repo_owner && !context.repo_owner) {
          context.repo_owner = parsed.repo_owner
          context.repo_name = parsed.repo_name
        }
      }
      if (flags.pr) {
        context.pr = flags.pr
      }
    }

    try {
      const todo = await createTodo({
        text: args.text,
        due_at,
        tags: flags.tag,
        context,
      })

      if (flags.json) {
        this.log(JSON.stringify(todo, null, 2))
        return
      }

      const branchSuffix = todo.context?.branch ? `  [${todo.context.branch}]` : ""
      this.log(`Added: ${todo.id}${branchSuffix}`)
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

/** Parse "42" or "owner/repo#42" into issue number + optional owner/name. */
function parseIssueRef(ref: string): { issue: number; repo_owner?: string; repo_name?: string } {
  const crossRepo = ref.match(/^([^/]+)\/([^#]+)#(\d+)$/)
  if (crossRepo) {
    return { issue: parseInt(crossRepo[3]), repo_owner: crossRepo[1], repo_name: crossRepo[2] }
  }
  const num = parseInt(ref)
  if (isNaN(num)) {
    throw new Error(`Invalid issue reference: "${ref}". Use a number (42) or owner/repo#42.`)
  }
  return { issue: num }
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  })
}
