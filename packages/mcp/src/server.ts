import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import {
  registerAppTool,
  registerAppResource,
  RESOURCE_MIME_TYPE,
} from "@modelcontextprotocol/ext-apps/server"
import { z } from "zod"
import { getGitContext, getBranch, getFilesChanged, getAllRemoteBranches } from "./shared/index.js"
import {
  createTodo,
  listTodos,
  completeTodo,
  deleteTodo,
  updateTodo,
} from "./api-client.js"
import { handleGetAgenda, AGENDA_UI_URI } from "./agenda.js"
import { buildAgendaHtml } from "./widgets/agenda.html.js"
import { getWidgetAppAsset } from "./widgets/widget-app-asset.js"

const PUBLIC_API_URL = (process.env.YDI_PUBLIC_API_URL ?? "https://api.yesdidit.com").replace(
  /\/$/,
  ""
)

/**
 * Create an McpServer instance with all YDI tools registered.
 * Used by both stdio and HTTP entry points.
 */
export function createMcpServer(): McpServer {
  const server = new McpServer({
    name: "yesdidit",
    version: "0.1.0",
  })

  // ── add_todo ──────────────────────────────────────────────────────────────

  server.registerTool(
    "add_todo",
    {
      title: "Add Todo",
      description:
        "Create a new todo item. Automatically captures git context (branch, commit, repo) from the current working directory.",
      inputSchema: {
        text: z.string().describe("The todo text"),
        due_at: z
          .string()
          .optional()
          .describe("Due date in ISO 8601 format (e.g. 2026-03-21T17:00:00Z)"),
        tags: z
          .array(z.string())
          .optional()
          .describe("Tags to attach to the todo"),
        cwd: z
          .string()
          .optional()
          .describe("Working directory to capture git context from (defaults to process.cwd())"),
        issue: z
          .number()
          .optional()
          .describe("GitHub issue number to link to this todo"),
        pr: z
          .number()
          .optional()
          .describe("GitHub PR number to link to this todo"),
      },
      annotations: { readOnlyHint: false, destructiveHint: false },
    },
    async ({ text, due_at, tags, cwd, issue, pr }) => {
      const context = getGitContext(cwd) ?? (issue || pr ? {} : null)
      if (context) {
        if (issue) context.issue = issue
        if (pr) context.pr = pr
      }
      const todo = await createTodo({ text, due_at, tags, context })
      const branchStr = todo.context?.branch ? ` [${todo.context.branch}]` : ""
      return {
        content: [
          {
            type: "text" as const,
            text: `Created todo: "${todo.text}" (${todo.id.slice(0, 8)})${todo.due_at ? ` — due ${todo.due_at}` : ""}${todo.tags.length ? ` [${todo.tags.join(", ")}]` : ""}${branchStr}`,
          },
        ],
      }
    }
  )

  // ── list_todos ────────────────────────────────────────────────────────────

  server.registerTool(
    "list_todos",
    {
      title: "List Todos",
      description: "List todos with optional filters. Supports filtering by git branch or repo.",
      inputSchema: {
        status: z
          .enum(["pending", "done", "all"])
          .optional()
          .describe("Filter by status (default: pending)"),
        filter: z
          .string()
          .optional()
          .describe("Text search filter"),
        tags: z
          .string()
          .optional()
          .describe("Comma-separated tags to filter by"),
        limit: z
          .number()
          .optional()
          .describe("Max number of todos to return"),
        branch: z
          .string()
          .optional()
          .describe("Filter todos by git branch name"),
        repo: z
          .string()
          .optional()
          .describe("Filter todos by repo (e.g. github.com/owner/repo)"),
        issue: z
          .number()
          .optional()
          .describe("Filter todos by GitHub issue number"),
        pr: z
          .number()
          .optional()
          .describe("Filter todos by GitHub PR number"),
        file: z
          .string()
          .optional()
          .describe("Filter todos by file path in files_changed context"),
        tag: z
          .string()
          .optional()
          .describe("Filter todos by git tag / release version"),
      },
      annotations: { readOnlyHint: true, destructiveHint: false },
    },
    async ({ status, filter, tags, limit, branch, repo, issue, pr, file, tag }) => {
      const todos = await listTodos({ status, filter, tags, limit, branch, repo, issue, pr, file, tag })
      if (todos.length === 0) {
        return {
          content: [{ type: "text" as const, text: "No todos found." }],
        }
      }

      const lines = todos.map((t) => {
        const check = t.status === "done" ? "[x]" : "[ ]"
        const due = t.due_at ? ` — due ${t.due_at}` : ""
        const tagStr = t.tags.length ? ` [${t.tags.join(", ")}]` : ""
        const branchStr = t.context?.branch ? ` [${t.context.branch}]` : ""
        return `${check} ${t.text} (${t.id.slice(0, 8)})${due}${tagStr}${branchStr}`
      })

      return {
        content: [
          {
            type: "text" as const,
            text: `${todos.length} todo${todos.length === 1 ? "" : "s"}:\n${lines.join("\n")}`,
          },
        ],
      }
    }
  )

  // ── complete_todo ─────────────────────────────────────────────────────────

  server.registerTool(
    "complete_todo",
    {
      title: "Complete Todo",
      description: "Mark a todo as done",
      inputSchema: {
        id: z.string().describe("The todo ID (full UUID or short prefix)"),
      },
      annotations: { readOnlyHint: false, destructiveHint: false },
    },
    async ({ id }) => {
      const todo = await completeTodo(id)
      return {
        content: [
          {
            type: "text" as const,
            text: `Completed: "${todo.text}" (${todo.id.slice(0, 8)})`,
          },
        ],
      }
    }
  )

  // ── delete_todo ───────────────────────────────────────────────────────────

  server.registerTool(
    "delete_todo",
    {
      title: "Delete Todo",
      description: "Delete a todo",
      inputSchema: {
        id: z.string().describe("The todo ID (full UUID or short prefix)"),
      },
      annotations: { readOnlyHint: false, destructiveHint: true },
    },
    async ({ id }) => {
      await deleteTodo(id)
      return {
        content: [
          {
            type: "text" as const,
            text: `Deleted todo ${id.slice(0, 8)}.`,
          },
        ],
      }
    }
  )

  // ── update_todo ───────────────────────────────────────────────────────────

  server.registerTool(
    "update_todo",
    {
      title: "Update Todo",
      description: "Update a todo's text, due date, or tags",
      inputSchema: {
        id: z.string().describe("The todo ID (full UUID or short prefix)"),
        text: z.string().optional().describe("New text for the todo"),
        due_at: z
          .string()
          .nullable()
          .optional()
          .describe("New due date (ISO 8601) or null to clear"),
        tags: z
          .array(z.string())
          .optional()
          .describe("New tags (replaces existing tags)"),
      },
      annotations: { readOnlyHint: false, destructiveHint: false },
    },
    async ({ id, text, due_at, tags }) => {
      const todo = await updateTodo(id, { text, due_at, tags })
      return {
        content: [
          {
            type: "text" as const,
            text: `Updated todo: "${todo.text}" (${todo.id.slice(0, 8)})${todo.due_at ? ` — due ${todo.due_at}` : ""}${todo.tags.length ? ` [${todo.tags.join(", ")}]` : ""}`,
          },
        ],
      }
    }
  )

  // ── list_branch_todos ──────────────────────────────────────────────────

  server.registerTool(
    "list_branch_todos",
    {
      title: "List Todos on Current Branch",
      description:
        "List todos for the current git branch. Auto-detects the branch from the working directory. Answers 'what todos are on this branch?'",
      inputSchema: {
        cwd: z
          .string()
          .optional()
          .describe("Working directory to detect branch from (defaults to process.cwd())"),
      },
      annotations: { readOnlyHint: true, destructiveHint: false },
    },
    async ({ cwd }) => {
      const branch = getBranch(cwd)
      if (!branch) {
        return {
          content: [
            {
              type: "text" as const,
              text: "Not in a git repository — cannot detect current branch.",
            },
          ],
        }
      }

      const todos = await listTodos({ branch })
      if (todos.length === 0) {
        return {
          content: [
            {
              type: "text" as const,
              text: `No todos found on branch: ${branch}`,
            },
          ],
        }
      }

      const lines = todos.map((t) => {
        const check = t.status === "done" ? "[x]" : "[ ]"
        const due = t.due_at ? ` — due ${t.due_at}` : ""
        const tagStr = t.tags.length ? ` [${t.tags.join(", ")}]` : ""
        return `${check} ${t.text} (${t.id.slice(0, 8)})${due}${tagStr}`
      })

      return {
        content: [
          {
            type: "text" as const,
            text: `Todos on branch ${branch} (${todos.length}):\n${lines.join("\n")}`,
          },
        ],
      }
    }
  )

  // ── list_file_todos ────────────────────────────────────────────────────

  server.registerTool(
    "list_file_todos",
    {
      title: "List Todos for a File",
      description:
        "List todos related to files you're currently changing. Auto-detects changed files from git diff in the working directory.",
      inputSchema: {
        cwd: z
          .string()
          .optional()
          .describe("Working directory to detect changed files from (defaults to process.cwd())"),
      },
      annotations: { readOnlyHint: true, destructiveHint: false },
    },
    async ({ cwd }) => {
      const files = getFilesChanged(cwd)
      if (!files || files.length === 0) {
        return {
          content: [
            {
              type: "text" as const,
              text: "No changed files detected (git diff is clean or not in a git repo).",
            },
          ],
        }
      }

      const allTodos: Array<{ text: string; id: string; file: string; due_at: string | null; tags: string[] }> = []
      const seen = new Set<string>()

      for (const file of files) {
        const todos = await listTodos({ file })
        for (const t of todos) {
          if (!seen.has(t.id)) {
            seen.add(t.id)
            allTodos.push({ text: t.text, id: t.id, file, due_at: t.due_at, tags: t.tags })
          }
        }
      }

      if (allTodos.length === 0) {
        return {
          content: [
            {
              type: "text" as const,
              text: `No todos found related to ${files.length} changed file(s): ${files.slice(0, 5).join(", ")}${files.length > 5 ? "..." : ""}`,
            },
          ],
        }
      }

      const lines = allTodos.map((t) => {
        const due = t.due_at ? ` — due ${t.due_at}` : ""
        const tagStr = t.tags.length ? ` [${t.tags.join(", ")}]` : ""
        return `[ ] ${t.text} (${t.id.slice(0, 8)})${due}${tagStr}`
      })

      return {
        content: [
          {
            type: "text" as const,
            text: `${allTodos.length} todo(s) related to your changed files:\n${lines.join("\n")}`,
          },
        ],
      }
    }
  )

  // ── standup ──────────────────────────────────────────────────────────────

  server.registerTool(
    "standup",
    {
      title: "Standup Report",
      description:
        "Get a standup report: recently completed todos grouped by branch, plus in-progress work. Claude can use this to prepare standup updates.",
      inputSchema: {
        since: z
          .string()
          .optional()
          .describe("ISO 8601 timestamp for lookback cutoff (default: 24 hours ago)"),
      },
      annotations: { readOnlyHint: true, destructiveHint: false },
    },
    async ({ since }) => {
      const cutoff = since ?? new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()

      const [completed, pending] = await Promise.all([
        listTodos({ status: "done", completed_since: cutoff, limit: 200 }),
        listTodos({ status: "pending", has_context: true, limit: 200 }),
      ])

      if (completed.length === 0 && pending.length === 0) {
        return {
          content: [{ type: "text" as const, text: "No completed or in-progress todos found." }],
        }
      }

      const lines: string[] = []
      lines.push(`Standup (since ${cutoff}):`)
      lines.push("")

      // Completed — grouped by branch
      if (completed.length === 0) {
        lines.push("Completed: none")
      } else {
        lines.push("Completed:")
        const { branched, unbranched } = groupByBranch(completed)
        for (const [branch, items] of branched) {
          const pr = items[0]?.context?.pr
          const suffix = pr ? ` (PR #${pr})` : ""
          lines.push(`  ${branch}${suffix}:`)
          for (const t of items) {
            lines.push(`    - ${t.text}`)
          }
        }
        if (unbranched.length > 0) {
          lines.push("  (no branch):")
          for (const t of unbranched) {
            lines.push(`    - ${t.text}`)
          }
        }
      }

      lines.push("")

      // In progress — summary by branch
      if (pending.length === 0) {
        lines.push("In Progress: none")
      } else {
        lines.push("In Progress:")
        const { branched, unbranched } = groupByBranch(pending)
        for (const [branch, items] of branched) {
          lines.push(`  ${branch} [${items.length} todo${items.length === 1 ? "" : "s"}]`)
        }
        if (unbranched.length > 0) {
          lines.push(`  (no branch) [${unbranched.length} todo${unbranched.length === 1 ? "" : "s"}]`)
        }
      }

      return {
        content: [{ type: "text" as const, text: lines.join("\n") }],
      }
    }
  )

  // ── sweep_todos ─────────────────────────────────────────────────────────

  server.registerTool(
    "sweep_todos",
    {
      title: "Sweep Stale Todos",
      description:
        "Find stale todos — todos on branches that have been deleted from the remote (PR likely merged). Returns structured data for Claude to act on using complete_todo or bulk operations.",
      inputSchema: {
        cwd: z
          .string()
          .optional()
          .describe("Working directory to check remote branches from (defaults to process.cwd())"),
      },
      annotations: { readOnlyHint: true, destructiveHint: false },
    },
    async ({ cwd }) => {
      const todos = await listTodos({ status: "pending", limit: 200, has_context: true })
      const todosWithBranch = todos.filter(
        (t) => t.context?.branch
      )

      if (todosWithBranch.length === 0) {
        return {
          content: [
            {
              type: "text" as const,
              text: "No todos with branch context found.",
            },
          ],
        }
      }

      const remoteBranches = getAllRemoteBranches(cwd)
      if (remoteBranches.size === 0) {
        return {
          content: [
            {
              type: "text" as const,
              text: "Could not reach remote — cannot determine stale branches.",
            },
          ],
        }
      }

      const stale = todosWithBranch.filter(
        (t) => !remoteBranches.has(t.context!.branch!)
      )

      if (stale.length === 0) {
        return {
          content: [
            {
              type: "text" as const,
              text: `No stale todos found. ${todosWithBranch.length} todo(s) on active branches.`,
            },
          ],
        }
      }

      const lines = stale.map((t) => {
        return `- ${t.text} (${t.id.slice(0, 8)}) [${t.context!.branch}]`
      })

      return {
        content: [
          {
            type: "text" as const,
            text: `Found ${stale.length} stale todo(s) (branch deleted on remote):\n${lines.join("\n")}\n\nUse complete_todo to mark these as done.`,
          },
        ],
      }
    }
  )

  // ── ui://ydi/agenda (widget resource) ───────────────────────────────────

  registerAppResource(
    server,
    "YDI Agenda",
    AGENDA_UI_URI,
    {
      description: "Interactive checklist of overdue, today, and this-week todos.",
    },
    async () => {
      const { hash } = getWidgetAppAsset()
      const widgetAppUrl = `${PUBLIC_API_URL}/mcp/widget-app/${hash}.js`
      return {
        contents: [
          {
            uri: AGENDA_UI_URI,
            mimeType: RESOURCE_MIME_TYPE,
            text: buildAgendaHtml(widgetAppUrl),
            _meta: {
              ui: { csp: { resourceDomains: [PUBLIC_API_URL] } },
            },
          },
        ],
      }
    }
  )

  // ── get_agenda ────────────────────────────────────────────────────────────

  registerAppTool(
    server,
    "get_agenda",
    {
      title: "Get Agenda",
      description:
        "Show the user's agenda — overdue, due today, and this week. Returns an interactive checklist (with inline complete + snooze) on hosts that render widgets; falls back to a markdown list elsewhere.",
      inputSchema: {
        window: z
          .enum(["today", "this-week", "overdue+today"])
          .optional()
          .describe("Which buckets to include (default: overdue+today)"),
        tag: z.string().optional().describe("Filter by tag"),
        branch: z.string().optional().describe("Filter by git branch"),
      },
      annotations: { readOnlyHint: true, destructiveHint: false },
      _meta: { ui: { resourceUri: AGENDA_UI_URI } },
    },
    async ({ window, tag, branch }) => {
      return handleGetAgenda({ window, tag, branch })
    }
  )

  return server
}

// ── helpers ────────────────────────────────────────────────────────────────

type TodoLike = { text: string; context?: { branch?: string; pr?: number } | null }

function groupByBranch<T extends TodoLike>(todos: T[]): { branched: Map<string, T[]>; unbranched: T[] } {
  const branched = new Map<string, T[]>()
  const unbranched: T[] = []

  for (const todo of todos) {
    if (todo.context?.branch) {
      const branch = todo.context.branch
      const list = branched.get(branch) ?? []
      list.push(todo)
      branched.set(branch, list)
    } else {
      unbranched.push(todo)
    }
  }

  return { branched, unbranched }
}
