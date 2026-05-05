import { Command, Args, Flags } from "@oclif/core"
import { markDone } from "../lib/api-client"
import { pickTodo } from "../lib/picker"

export default class Done extends Command {
  static description = "Mark a todo as done"

  static args = {
    id: Args.string({ required: false, description: "Todo ID or prefix (omit to pick interactively)" }),
  }

  static flags = {
    json: Flags.boolean({
      description: "Output as JSON",
      default: false,
    }),
  }

  async run(): Promise<void> {
    const { args, flags } = await this.parse(Done)

    try {
      const id = args.id ?? (await pickTodo({ message: "Mark done:" }))
      const todo = await markDone(id)

      if (flags.json) {
        this.log(JSON.stringify(todo, null, 2))
        return
      }

      this.log(`Done: ${todo.id.slice(0, 8)}  ${todo.text}`)
    } catch (err) {
      this.error(err instanceof Error ? err.message : String(err))
    }
  }
}
