import { Command, Flags } from "@oclif/core"
import { getGitContext } from "../shared"

export default class Context extends Command {
  static description =
    "Show git context that would be captured with a new todo"

  static flags = {
    json: Flags.boolean({
      description: "Output as JSON",
      default: false,
    }),
  }

  async run(): Promise<void> {
    const { flags } = await this.parse(Context)
    const context = getGitContext()

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
