import { listTodos, type Todo } from "./api-client"

/** Format a todo for display in the picker. */
function formatLine(todo: Todo): string {
  const text = todo.text.length > 42 ? todo.text.slice(0, 41) + "…" : todo.text.padEnd(42)
  const due = todo.due_at ? `  ${formatDue(todo.due_at)}` : ""
  const tags = todo.tags.length > 0 ? `  [${todo.tags.join(", ")}]` : ""
  return `${todo.id.slice(0, 8)}  ${text}${due}${tags}`
}

function formatDue(iso: string): string {
  const d = new Date(iso)
  const now = new Date()
  const startOfToday = new Date(now)
  startOfToday.setHours(0, 0, 0, 0)
  const startOfTomorrow = new Date(startOfToday)
  startOfTomorrow.setDate(startOfTomorrow.getDate() + 1)

  const time = d.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" })
  if (d < startOfToday) return `overdue`
  if (d < startOfTomorrow) return `today ${time}`
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" })
}

export async function pickTodo(opts: {
  message: string
  status?: "pending" | "done" | "all"
}): Promise<string> {
  const todos = await listTodos({ status: opts.status ?? "pending", limit: 200 })

  if (todos.length === 0) {
    throw new Error("No todos found.")
  }

  // Build a label → id map
  const labelToId = new Map<string, string>()
  const choices: string[] = []
  for (const todo of todos) {
    const label = formatLine(todo)
    labelToId.set(label, todo.id)
    choices.push(label)
  }

  // enquirer is CJS — require it dynamically so TypeScript doesn't complain
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { AutoComplete } = require("enquirer") as {
    AutoComplete: new (opts: {
      name: string
      message: string
      limit: number
      choices: string[]
    }) => { run(): Promise<string> }
  }

  const prompt = new AutoComplete({
    name: "todo",
    message: opts.message,
    limit: 10,
    choices,
  })

  const selected = await prompt.run()
  const id = labelToId.get(selected)
  if (!id) throw new Error("Selection failed.")
  return id
}
