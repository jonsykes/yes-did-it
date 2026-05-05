import { Command, Flags } from "@oclif/core"
import { login } from "../lib/auth"

export default class Login extends Command {
  static description = "Log in to Yes! Did It via browser OAuth"

  static flags = {
    github: Flags.boolean({
      description: "Use GitHub instead of Google",
      default: false,
    }),
  }

  async run(): Promise<void> {
    const { flags } = await this.parse(Login)
    const provider = flags.github ? "github" : "google"

    this.log(`Opening browser for ${provider} login...`)

    try {
      const { email, name } = await login(provider)
      this.log(`Logged in as ${name ?? email}`)
    } catch (err) {
      this.error(err instanceof Error ? err.message : String(err))
    }
  }
}
