import { Command, Flags } from "@oclif/core"
import { getGitContext, formatKeyValue } from "../shared"
import {
  agentFlag,
  fieldsFlag,
  parseFields,
  renderAgentSuccess,
} from "../lib/agent"

export default class Context extends Command {
  static description =
    "Show git context that would be captured with a new todo"

  static flags = {
    json: Flags.boolean({
      description: "Output as JSON",
      default: false,
    }),
    agent: agentFlag,
    fields: fieldsFlag,
  }

  async run(): Promise<void> {
    const { flags } = await this.parse(Context)
    const startedAt = Date.now()
    const command = `ydi context${flags.agent ? " --agent" : ""}`
    const context = getGitContext()

    if (flags.agent) {
      const fields = parseFields(flags.fields)
      let result: string
      let summary: string
      if (!context) {
        result = "Not in a git repository."
        summary = "no git repo"
      } else {
        result = formatKeyValue(context as Record<string, unknown>, fields)
        summary = `branch: ${context.branch ?? "—"}`
      }

      const actions: string[] = []
      if (context) {
        actions.push("Add a todo with this context: `ydi add \"<text>\" --agent`")
        if (context.branch) {
          actions.push(`List todos on this branch: \`ydi list --current-branch --agent\``)
        }
      } else {
        actions.push("List all todos: `ydi list --agent`")
      }

      this.log(
        renderAgentSuccess({
          command,
          statusSummary: summary,
          result,
          actions,
          startedAt,
        }),
      )
      return
    }

    if (flags.json) {
      this.log(JSON.stringify(context, null, 2))
      return
    }

    if (!context) {
      this.log("Not in a git repository")
      return
    }

    if (context.branch) this.log(`Branch:  ${context.branch}`)
    if (context.commit) this.log(`Commit:  ${context.commit}`)
    if (context.repo) this.log(`Repo:    ${context.repo}`)
    if (context.repo_owner && context.repo_name) {
      this.log(`Slug:    ${context.repo_owner}/${context.repo_name}`)
    }
    if (context.worktree) this.log(`Worktree: yes`)
  }
}
