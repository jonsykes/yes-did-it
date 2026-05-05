import { Command, Args } from "@oclif/core"
import { deleteTodo } from "../lib/api-client"
import { pickTodo } from "../lib/picker"

export default class Delete extends Command {
  static description = "Delete a todo"

  static args = {
    id: Args.string({ required: false, description: "Todo ID or prefix (omit to pick interactively)" }),
  }

  async run(): Promise<void> {
    const { args } = await this.parse(Delete)

    try {
      const id = args.id ?? (await pickTodo({ message: "Delete:", status: "all" }))
      await deleteTodo(id)
      this.log(`Deleted: ${id.slice(0, 8)}`)
    } catch (err) {
      this.error(err instanceof Error ? err.message : String(err))
    }
  }
}
