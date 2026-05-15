import { Command, Flags, Args } from "@oclif/core"
import * as chrono from "chrono-node"
import { createTodo } from "../lib/api-client"
import { getGitContext, type GitContext, formatKeyValue } from "../shared"
import { getSetting } from "../lib/settings"
import {
  agentFlag,
  confirmFlag,
  fieldsFlag,
  parseFields,
  renderAgentDryRun,
  renderAgentError,
  renderAgentSuccess,
} from "../lib/agent"

const DEFAULT_ADD_FIELDS = ["id", "text", "status", "due_at", "tags", "branch"] as const

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
    agent: agentFlag,
    confirm: confirmFlag,
    fields: fieldsFlag,
  }

  static agentMeta = {
    examples: [
      'ydi add "Refactor login" --agent',
      'ydi add "Fix flake" --agent --confirm',
      'ydi add "Bug" --agent --confirm --due "tomorrow 9am" --tag flake',
      'ydi add "Track" --agent --confirm --pr 123',
    ],
    related: ["ydi list --agent", "ydi context --agent"],
  }

  async run(): Promise<void> {
    const { args, flags } = await this.parse(Add)
    const startedAt = Date.now()
    const command = buildAddCommand(args.text, flags)

    let due_at: string | null = null
    if (flags.due) {
      const timezone = getSetting("timezone") as string
      const parsed = chrono.parseDate(flags.due, { timezone })
      if (!parsed) {
        return this.failVal(flags.agent, command, `Could not parse due date: "${flags.due}"`, startedAt)
      }
      due_at = parsed.toISOString()
    }

    const autoContext = getSetting("context.auto")
    let context: GitContext | undefined = (flags["no-context"] || !autoContext) ? undefined : getGitContext() ?? undefined

    if (flags.issue || flags.pr) {
      context = context ?? {}
      if (flags.issue) {
        try {
          const parsed = parseIssueRef(flags.issue)
          context.issue = parsed.issue
          if (parsed.repo_owner && !context.repo_owner) {
            context.repo_owner = parsed.repo_owner
            context.repo_name = parsed.repo_name
          }
        } catch (err) {
          return this.failVal(
            flags.agent,
            command,
            err instanceof Error ? err.message : String(err),
            startedAt,
          )
        }
      }
      if (flags.pr) {
        context.pr = flags.pr
      }
    }

    if (flags.agent && !flags.confirm) {
      const fields = parseFields(flags.fields) ?? [...DEFAULT_ADD_FIELDS]
      const preview: Record<string, unknown> = {
        text: args.text,
        due_at: due_at ?? "",
        tags: flags.tag ?? [],
        branch: context?.branch ?? "",
        repo: context?.repo ?? "",
        issue: context?.issue ?? "",
        pr: context?.pr ?? "",
      }
      this.log(
        renderAgentDryRun({
          command,
          statusSummary: "Would add 1 todo",
          result: formatKeyValue(preview, fields.filter((f) => f !== "id" && f !== "status")),
          confirmCommand: `${command} --confirm`,
          startedAt,
        }),
      )
      return
    }

    try {
      const todo = await createTodo({
        text: args.text,
        due_at,
        tags: flags.tag,
        context,
      })

      if (flags.agent) {
        const fields = parseFields(flags.fields) ?? [...DEFAULT_ADD_FIELDS]
        const row: Record<string, unknown> = {
          id: todo.id.slice(0, 8),
          text: todo.text,
          status: todo.status,
          due_at: todo.due_at ?? "",
          tags: todo.tags,
          branch: todo.context?.branch ?? "",
        }
        this.log(
          renderAgentSuccess({
            command,
            statusSummary: `Added 1 todo`,
            result: formatKeyValue(row, fields),
            actions: [
              `Mark done (dry-run): \`ydi done ${todo.id.slice(0, 8)} --agent\``,
              `Mark done: \`ydi done ${todo.id.slice(0, 8)} --agent --confirm\``,
            ],
            startedAt,
            meta: { id: `id: ${todo.id}` },
          }),
        )
        return
      }

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

function buildAddCommand(text: string, flags: Record<string, unknown>): string {
  const parts = ["ydi add", JSON.stringify(text)]
  if (flags.due) parts.push(`--due ${JSON.stringify(flags.due)}`)
  if (Array.isArray(flags.tag)) {
    for (const t of flags.tag as string[]) parts.push(`--tag ${JSON.stringify(t)}`)
  }
  if (flags.issue) parts.push(`--issue ${flags.issue}`)
  if (flags.pr) parts.push(`--pr ${flags.pr}`)
  if (flags["no-context"]) parts.push("--no-context")
  if (flags.agent) parts.push("--agent")
  if (flags.fields) parts.push(`--fields ${flags.fields}`)
  return parts.join(" ")
}

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
