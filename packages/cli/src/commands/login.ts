import { Command, Flags } from "@oclif/core"
import { login } from "../lib/auth"
import { formatKeyValue } from "../shared"
import {
  agentFlag,
  fieldsFlag,
  parseFields,
  renderAgentError,
  renderAgentSuccess,
} from "../lib/agent"

const DEFAULT_LOGIN_FIELDS = ["email", "name", "provider"] as const

export default class Login extends Command {
  static description = "Log in to Yes! Did It via browser OAuth"

  static flags = {
    github: Flags.boolean({
      description: "Use GitHub instead of Google",
      default: false,
    }),
    agent: agentFlag,
    fields: fieldsFlag,
  }

  async run(): Promise<void> {
    const { flags } = await this.parse(Login)
    const startedAt = Date.now()
    const provider = flags.github ? "github" : "google"
    const command = `ydi login${flags.github ? " --github" : ""}${flags.agent ? " --agent" : ""}`

    if (!flags.agent) {
      this.log(`Opening browser for ${provider} login...`)
    }

    try {
      const { email, name } = await login(provider)

      if (flags.agent) {
        const fields = parseFields(flags.fields) ?? [...DEFAULT_LOGIN_FIELDS]
        const row: Record<string, unknown> = { email, name: name ?? "", provider }
        this.log(
          renderAgentSuccess({
            command,
            statusSummary: `Logged in as ${name ?? email}`,
            result: formatKeyValue(row, fields),
            actions: [`List todos: \`ydi list --agent\``],
            startedAt,
          }),
        )
        return
      }

      this.log(`Logged in as ${name ?? email}`)
    } catch (err) {
      if (flags.agent) {
        const { output, exitCode } = renderAgentError(command, err, startedAt)
        this.log(output)
        this.exit(exitCode)
      }
      this.error(err instanceof Error ? err.message : String(err))
    }
  }
}
