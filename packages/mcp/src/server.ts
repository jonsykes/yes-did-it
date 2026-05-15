import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import {
  registerAppTool,
  registerAppResource,
  RESOURCE_MIME_TYPE,
} from "@modelcontextprotocol/ext-apps/server"
import { z } from "zod"
import {
  getGitContext,
  getBranch,
  getFilesChanged,
  getAllRemoteBranches,
  formatAgentResponse,
  formatMarkdownTable,
  renderAgentDryRun,
  renderAgentSuccess,
  renderAgentErrorEnvelope,
  EXIT_CODES,
} from "./shared/index.js"
import {
  createTodo,
  listTodos,
  listTodosPage,
  completeTodo,
  deleteTodo,
  updateTodo,
  findTodoByIdOrPrefix,
} from "./api-client.js"
import { handleGetAgenda, AGENDA_UI_URI } from "./agenda.js"
import { buildAgendaHtml } from "./widgets/agenda.html.js"
import { getWidgetAppAsset } from "./widgets/widget-app-asset.js"

const PUBLIC_API_URL = (process.env.YDI_PUBLIC_API_URL ?? "https://api.yesdidit.com").replace(
  /\/$/,
  ""
)

// ── shared zod fragments ────────────────────────────────────────────────────

// UUID v4 chars + short prefix. Rejects path traversal, embedded query params,
// and control chars by construction.
const idSchema = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[a-zA-Z0-9-]+$/, "id must be a UUID or short hex prefix")

const textSchema = z
  .string()
  .min(1)
  .max(5000)
  .refine((s) => !/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/.test(s), {
    message: "text contains control characters",
  })

const branchSchema = z.string().min(1).max(255)
const repoSchema = z.string().min(1).max(255)
const tagSchema = z.string().min(1).max(255)
const filterSchema = z.string().min(1).max(255)
const tagsCsvSchema = z.string().max(1000)
const limitSchema = z.number().int().min(1).max(500)

const confirmSchema = z
  .boolean()
  .default(false)
  .describe(
    "Required to actually execute the mutation. Without confirm:true, returns a dry-run envelope describing the would-be effect."
  )

// ── envelope helpers ────────────────────────────────────────────────────────

function envelopeContent(text: string) {
  return { content: [{ type: "text" as const, text }] }
}

function errorEnvelopeContent(command: string, err: unknown) {
  const { output } = renderAgentErrorEnvelope(command, err)
  return {
    content: [{ type: "text" as const, text: output }],
    isError: true,
  }
}

function todoRow(t: {
  id: string
  text: string
  status: string
  due_at: string | null
  tags: string[]
  context: { branch?: string; pr?: number; repo?: string } | null
}) {
  return {
    id: t.id.slice(0, 8),
    text: t.text,
    status: t.status,
    due_at: t.due_at,
    tags: t.tags,
    branch: t.context?.branch ?? null,
    pr: t.context?.pr ?? null,
    repo: t.context?.repo ?? null,
  }
}

function describeTodo(t: {
  id: string
  text: string
  due_at: string | null
  tags: string[]
}) {
  return [
    `- **id:** \`${t.id.slice(0, 8)}\``,
    `- **text:** ${t.text}`,
    `- **due_at:** ${t.due_at ?? "—"}`,
    `- **tags:** ${t.tags.length ? t.tags.join(", ") : "—"}`,
  ].join("\n")
}

/**
 * Create an McpServer instance with all YDI tools registered.
 * Used by both stdio and HTTP entry points.
 */
export function createMcpServer(): McpServer {
  const server = new McpServer({
    name: "yesdidit",
    version: "0.7.0",
  })

  // ── add_todo ──────────────────────────────────────────────────────────────

  server.registerTool(
    "add_todo",
    {
      title: "Add Todo",
      description:
        "Create a new todo item. Automatically captures git context. Dry-runs unless confirm: true is set.",
      inputSchema: {
        text: textSchema.describe("The todo text"),
        due_at: z
          .string()
          .max(64)
          .optional()
          .describe("Due date in ISO 8601 format"),
        tags: z
          .array(tagSchema)
          .max(50)
          .optional()
          .describe("Tags to attach to the todo"),
        cwd: z
          .string()
          .max(1024)
          .optional()
          .describe("Working directory to capture git context from"),
        issue: z.number().int().optional().describe("GitHub issue number to link"),
        pr: z.number().int().optional().describe("GitHub PR number to link"),
        confirm: confirmSchema,
      },
      annotations: { readOnlyHint: false, destructiveHint: false },
    },
    async ({ text, due_at, tags, cwd, issue, pr, confirm }) => {
      const command = "add_todo"
      try {
        const context = getGitContext(cwd) ?? (issue || pr ? {} : null)
        if (context) {
          if (issue) context.issue = issue
          if (pr) context.pr = pr
        }

        if (!confirm) {
          const preview = describeTodo({ id: "00000000", text, due_at: due_at ?? null, tags: tags ?? [] })
          const branchHint = context && "branch" in context && context.branch ? `\n- **branch:** ${context.branch}` : ""
          return envelopeContent(
            renderAgentDryRun({
              command,
              statusSummary: "Would create todo",
              result: preview + branchHint,
              confirmHint: 'call again with `confirm: true`',
            })
          )
        }

        const todo = await createTodo({ text, due_at, tags, context })
        return envelopeContent(
          renderAgentSuccess({
            command,
            statusSummary: `Created todo ${todo.id.slice(0, 8)}`,
            result: describeTodo(todo) +
              (todo.context?.branch ? `\n- **branch:** ${todo.context.branch}` : ""),
            actions: [
              `Mark done: \`complete_todo({id: "${todo.id.slice(0, 8)}", confirm: true})\``,
              `List branch todos: \`list_branch_todos({})\``,
            ],
          })
        )
      } catch (err) {
        return errorEnvelopeContent(command, err)
      }
    }
  )

  // ── list_todos ────────────────────────────────────────────────────────────

  server.registerTool(
    "list_todos",
    {
      title: "List Todos",
      description:
        "List todos with optional filters. Supports filtering by git branch, repo, issue, PR, file, or tag.",
      inputSchema: {
        status: z
          .enum(["pending", "done", "all"])
          .optional()
          .describe("Filter by status (default: pending)"),
        filter: filterSchema.optional().describe("Text search filter"),
        tags: tagsCsvSchema.optional().describe("Comma-separated tags to filter by"),
        limit: limitSchema.optional().describe("Max number of todos to return"),
        branch: branchSchema.optional().describe("Filter by git branch name"),
        repo: repoSchema.optional().describe("Filter by repo"),
        issue: z.number().int().optional().describe("Filter by GitHub issue number"),
        pr: z.number().int().optional().describe("Filter by GitHub PR number"),
        file: z.string().max(1024).optional().describe("Filter by file path"),
        tag: tagSchema.optional().describe("Filter by git tag / release version"),
        cursor: z
          .string()
          .max(64)
          .optional()
          .describe("Pagination cursor returned by a previous list_todos call"),
      },
      annotations: { readOnlyHint: true, destructiveHint: false },
    },
    async ({ status, filter, tags, limit, branch, repo, issue, pr, file, tag, cursor }) => {
      const command = "list_todos"
      try {
        const { todos, cursor: nextCursor } = await listTodosPage({
          status,
          filter,
          tags,
          limit,
          branch,
          repo,
          issue,
          pr,
          file,
          tag,
          cursor,
        })

        if (todos.length === 0) {
          return envelopeContent(
            renderAgentSuccess({
              command,
              statusSummary: "0 todos",
              result: "No todos match these filters.",
              actions: [
                `Try widening filters or call \`list_branch_todos({})\``,
              ],
            })
          )
        }

        const rows = todos.map(todoRow)
        const actions: string[] = []
        if (nextCursor) {
          actions.push(
            `Next page: \`list_todos({cursor: "${nextCursor}"${limit ? `, limit: ${limit}` : ""}})\``
          )
        }
        if (todos[0]) {
          actions.push(
            `Mark first todo done (dry-run): \`complete_todo({id: "${todos[0].id.slice(0, 8)}"})\``
          )
        }

        const meta: Record<string, string> = {}
        if (cursor) meta.cursor = `cursor: ${cursor}`
        if (nextCursor) meta.next_cursor = `next_cursor: ${nextCursor}`

        return envelopeContent(
          renderAgentSuccess({
            command,
            statusSummary:
              `${todos.length} todo${todos.length === 1 ? "" : "s"}` +
              (nextCursor ? " (more available)" : ""),
            result: formatMarkdownTable(rows as unknown as Record<string, unknown>[]),
            actions,
            meta: Object.keys(meta).length > 0 ? meta : undefined,
          })
        )
      } catch (err) {
        return errorEnvelopeContent(command, err)
      }
    }
  )

  // ── complete_todo ─────────────────────────────────────────────────────────

  server.registerTool(
    "complete_todo",
    {
      title: "Complete Todo",
      description:
        "Mark a todo as done. Dry-runs unless confirm: true is set.",
      inputSchema: {
        id: idSchema.describe("The todo ID (full UUID or short prefix)"),
        confirm: confirmSchema,
      },
      annotations: { readOnlyHint: false, destructiveHint: false },
    },
    async ({ id, confirm }) => {
      const command = "complete_todo"
      try {
        if (!confirm) {
          const target = await findTodoByIdOrPrefix(id)
          return envelopeContent(
            renderAgentDryRun({
              command,
              statusSummary: "Would mark this todo done",
              result: describeTodo(target),
              confirmHint: `call again with \`confirm: true\``,
            })
          )
        }
        const todo = await completeTodo(id)
        return envelopeContent(
          renderAgentSuccess({
            command,
            statusSummary: `Completed ${todo.id.slice(0, 8)}`,
            result: describeTodo(todo),
            actions: [`Verify with \`list_todos({status: "done", limit: 5})\``],
          })
        )
      } catch (err) {
        return errorEnvelopeContent(command, err)
      }
    }
  )

  // ── delete_todo ───────────────────────────────────────────────────────────

  server.registerTool(
    "delete_todo",
    {
      title: "Delete Todo",
      description: "Delete a todo. Dry-runs unless confirm: true is set.",
      inputSchema: {
        id: idSchema.describe("The todo ID (full UUID or short prefix)"),
        confirm: confirmSchema,
      },
      annotations: { readOnlyHint: false, destructiveHint: true },
    },
    async ({ id, confirm }) => {
      const command = "delete_todo"
      try {
        if (!confirm) {
          const target = await findTodoByIdOrPrefix(id)
          return envelopeContent(
            renderAgentDryRun({
              command,
              statusSummary: "Would delete this todo",
              result: describeTodo(target),
              confirmHint: `call again with \`confirm: true\``,
              warnings: ["Deletion is irreversible."],
            })
          )
        }
        await deleteTodo(id)
        return envelopeContent(
          renderAgentSuccess({
            command,
            statusSummary: `Deleted ${id.slice(0, 8)}`,
            result: `Todo \`${id.slice(0, 8)}\` removed.`,
            actions: [`Verify with \`list_todos({})\``],
          })
        )
      } catch (err) {
        return errorEnvelopeContent(command, err)
      }
    }
  )

  // ── update_todo ───────────────────────────────────────────────────────────

  server.registerTool(
    "update_todo",
    {
      title: "Update Todo",
      description:
        "Update a todo's text, due date, or tags. Dry-runs unless confirm: true is set.",
      inputSchema: {
        id: idSchema.describe("The todo ID (full UUID or short prefix)"),
        text: textSchema.optional().describe("New text for the todo"),
        due_at: z
          .string()
          .max(64)
          .nullable()
          .optional()
          .describe("New due date (ISO 8601) or null to clear"),
        tags: z
          .array(tagSchema)
          .max(50)
          .optional()
          .describe("New tags (replaces existing)"),
        confirm: confirmSchema,
      },
      annotations: { readOnlyHint: false, destructiveHint: false },
    },
    async ({ id, text, due_at, tags, confirm }) => {
      const command = "update_todo"
      try {
        if (!confirm) {
          const target = await findTodoByIdOrPrefix(id)
          const changes: string[] = []
          if (text !== undefined && text !== target.text) {
            changes.push(`text: "${target.text}" → "${text}"`)
          }
          if (due_at !== undefined && due_at !== target.due_at) {
            changes.push(`due_at: ${target.due_at ?? "—"} → ${due_at ?? "—"}`)
          }
          if (tags !== undefined) {
            const prev = target.tags.join(",")
            const next = tags.join(",")
            if (prev !== next) changes.push(`tags: [${prev}] → [${next}]`)
          }
          const result = changes.length
            ? `${describeTodo(target)}\n\n**Changes:**\n${changes.map((c) => `- ${c}`).join("\n")}`
            : `${describeTodo(target)}\n\n(no changes)`
          return envelopeContent(
            renderAgentDryRun({
              command,
              statusSummary: changes.length ? "Would update this todo" : "No changes",
              result,
              confirmHint: `call again with \`confirm: true\``,
            })
          )
        }
        const todo = await updateTodo(id, { text, due_at, tags })
        return envelopeContent(
          renderAgentSuccess({
            command,
            statusSummary: `Updated ${todo.id.slice(0, 8)}`,
            result: describeTodo(todo),
            actions: [`Verify with \`list_todos({})\``],
          })
        )
      } catch (err) {
        return errorEnvelopeContent(command, err)
      }
    }
  )

  // ── list_branch_todos ──────────────────────────────────────────────────

  server.registerTool(
    "list_branch_todos",
    {
      title: "List Todos on Current Branch",
      description:
        "List todos for the current git branch. Auto-detects the branch from the working directory.",
      inputSchema: {
        cwd: z
          .string()
          .max(1024)
          .optional()
          .describe("Working directory to detect branch from"),
      },
      annotations: { readOnlyHint: true, destructiveHint: false },
    },
    async ({ cwd }) => {
      const command = "list_branch_todos"
      try {
        const branch = getBranch(cwd)
        if (!branch) {
          return envelopeContent(
            formatAgentResponse({
              command,
              status: "error",
              exitCode: EXIT_CODES.USAGE_ERROR,
              statusSummary: "Not in a git repository",
              result: "Cannot detect current branch.",
              errors:
                "- **Code:** `USAGE_ERROR`\n- **Message:** Not in a git repository\n- **Retryable:** No\n- **Suggestion:** Run from within a git checkout, or pass `cwd`.",
            })
          )
        }

        const todos = await listTodos({ branch })
        if (todos.length === 0) {
          return envelopeContent(
            renderAgentSuccess({
              command,
              statusSummary: `0 todos on ${branch}`,
              result: `No todos found on branch \`${branch}\`.`,
            })
          )
        }

        const rows = todos.map(todoRow)
        return envelopeContent(
          renderAgentSuccess({
            command,
            statusSummary: `${todos.length} todo${todos.length === 1 ? "" : "s"} on ${branch}`,
            result: formatMarkdownTable(rows as unknown as Record<string, unknown>[]),
          })
        )
      } catch (err) {
        return errorEnvelopeContent(command, err)
      }
    }
  )

  // ── list_file_todos ────────────────────────────────────────────────────

  server.registerTool(
    "list_file_todos",
    {
      title: "List Todos for a File",
      description:
        "List todos related to files you're currently changing. Auto-detects from git diff.",
      inputSchema: {
        cwd: z
          .string()
          .max(1024)
          .optional()
          .describe("Working directory to detect changed files from"),
      },
      annotations: { readOnlyHint: true, destructiveHint: false },
    },
    async ({ cwd }) => {
      const command = "list_file_todos"
      try {
        const files = getFilesChanged(cwd)
        if (!files || files.length === 0) {
          return envelopeContent(
            renderAgentSuccess({
              command,
              statusSummary: "No changed files",
              result: "git diff is clean or not in a git repo.",
            })
          )
        }

        const allTodos: Array<{
          text: string
          id: string
          file: string
          due_at: string | null
          tags: string[]
        }> = []
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
          const sample = files.slice(0, 5).join(", ") + (files.length > 5 ? "…" : "")
          return envelopeContent(
            renderAgentSuccess({
              command,
              statusSummary: `0 todos for ${files.length} changed file(s)`,
              result: `No todos found related to: ${sample}`,
            })
          )
        }

        const rows = allTodos.map((t) => ({
          id: t.id.slice(0, 8),
          text: t.text,
          file: t.file,
          due_at: t.due_at,
          tags: t.tags,
        }))
        return envelopeContent(
          renderAgentSuccess({
            command,
            statusSummary: `${allTodos.length} todo(s) related to your changes`,
            result: formatMarkdownTable(rows as unknown as Record<string, unknown>[]),
          })
        )
      } catch (err) {
        return errorEnvelopeContent(command, err)
      }
    }
  )

  // ── standup ──────────────────────────────────────────────────────────────

  server.registerTool(
    "standup",
    {
      title: "Standup Report",
      description:
        "Get a standup report: recently completed todos grouped by branch, plus in-progress work.",
      inputSchema: {
        since: z
          .string()
          .max(64)
          .optional()
          .describe("ISO 8601 timestamp for lookback cutoff (default: 24h ago)"),
      },
      annotations: { readOnlyHint: true, destructiveHint: false },
    },
    async ({ since }) => {
      const command = "standup"
      try {
        const cutoff = since ?? new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()

        const [completed, pending] = await Promise.all([
          listTodos({ status: "done", completed_since: cutoff, limit: 200 }),
          listTodos({ status: "pending", has_context: true, limit: 200 }),
        ])

        if (completed.length === 0 && pending.length === 0) {
          return envelopeContent(
            renderAgentSuccess({
              command,
              statusSummary: `Nothing since ${cutoff}`,
              result: "No completed or in-progress todos found.",
            })
          )
        }

        const lines: string[] = []
        lines.push(`### Completed since ${cutoff}`)
        if (completed.length === 0) {
          lines.push("None.")
        } else {
          const { branched, unbranched } = groupByBranch(completed)
          for (const [branch, items] of branched) {
            const pr = items[0]?.context?.pr
            const suffix = pr ? ` (PR #${pr})` : ""
            lines.push(`\n**${branch}${suffix}**`)
            for (const t of items) lines.push(`- ${t.text}`)
          }
          if (unbranched.length > 0) {
            lines.push(`\n**(no branch)**`)
            for (const t of unbranched) lines.push(`- ${t.text}`)
          }
        }

        lines.push("")
        lines.push("### In progress")
        if (pending.length === 0) {
          lines.push("None.")
        } else {
          const { branched, unbranched } = groupByBranch(pending)
          for (const [branch, items] of branched) {
            lines.push(`- ${branch} — ${items.length} todo${items.length === 1 ? "" : "s"}`)
          }
          if (unbranched.length > 0) {
            lines.push(`- (no branch) — ${unbranched.length} todo${unbranched.length === 1 ? "" : "s"}`)
          }
        }

        return envelopeContent(
          renderAgentSuccess({
            command,
            statusSummary: `${completed.length} completed, ${pending.length} in progress`,
            result: lines.join("\n"),
          })
        )
      } catch (err) {
        return errorEnvelopeContent(command, err)
      }
    }
  )

  // ── sweep_todos ─────────────────────────────────────────────────────────

  server.registerTool(
    "sweep_todos",
    {
      title: "Sweep Stale Todos",
      description:
        "Find stale todos — todos on branches deleted from the remote (PR likely merged).",
      inputSchema: {
        cwd: z
          .string()
          .max(1024)
          .optional()
          .describe("Working directory to check remote branches from"),
      },
      annotations: { readOnlyHint: true, destructiveHint: false },
    },
    async ({ cwd }) => {
      const command = "sweep_todos"
      try {
        const todos = await listTodos({ status: "pending", limit: 200, has_context: true })
        const todosWithBranch = todos.filter((t) => t.context?.branch)

        if (todosWithBranch.length === 0) {
          return envelopeContent(
            renderAgentSuccess({
              command,
              statusSummary: "0 todos with branch context",
              result: "No todos with branch context found.",
            })
          )
        }

        const remoteBranches = getAllRemoteBranches(cwd)
        if (remoteBranches.size === 0) {
          return envelopeContent(
            formatAgentResponse({
              command,
              status: "error",
              exitCode: EXIT_CODES.TIMEOUT,
              statusSummary: "Could not reach remote",
              result: "None",
              errors:
                "- **Code:** `TIMEOUT`\n- **Message:** Could not reach remote — cannot determine stale branches.\n- **Retryable:** Yes\n- **Suggestion:** Retry once the network is reachable.",
            })
          )
        }

        const stale = todosWithBranch.filter((t) => !remoteBranches.has(t.context!.branch!))

        if (stale.length === 0) {
          return envelopeContent(
            renderAgentSuccess({
              command,
              statusSummary: `0 stale / ${todosWithBranch.length} active`,
              result: `No stale todos found. ${todosWithBranch.length} todo(s) on active branches.`,
            })
          )
        }

        const rows = stale.map((t) => ({
          id: t.id.slice(0, 8),
          text: t.text,
          branch: t.context!.branch,
        }))
        return envelopeContent(
          renderAgentSuccess({
            command,
            statusSummary: `${stale.length} stale todo(s)`,
            result: formatMarkdownTable(rows as unknown as Record<string, unknown>[]),
            actions: [
              `Complete a stale todo: \`complete_todo({id: "${stale[0].id.slice(0, 8)}", confirm: true})\``,
            ],
          })
        )
      } catch (err) {
        return errorEnvelopeContent(command, err)
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
  //
  // Multi-channel: structuredContent + _meta.ydi.todos drive the widget;
  // the model-facing TextContent is wrapped in the agent envelope; the
  // user-facing markdown fallback (audience:["user"]) is left as-is.

  registerAppTool(
    server,
    "get_agenda",
    {
      title: "Get Agenda",
      description:
        "Show the user's agenda — overdue, due today, and this week. Returns an interactive checklist on widget-capable hosts, with a markdown fallback elsewhere.",
      inputSchema: {
        window: z
          .enum(["today", "this-week", "overdue+today"])
          .optional()
          .describe("Which buckets to include (default: overdue+today)"),
        tag: tagSchema.optional().describe("Filter by tag"),
        branch: branchSchema.optional().describe("Filter by git branch"),
      },
      annotations: { readOnlyHint: true, destructiveHint: false },
      _meta: { ui: { resourceUri: AGENDA_UI_URI } },
    },
    async ({ window, tag, branch }) => {
      const command = "get_agenda"
      try {
        const base = await handleGetAgenda({ window, tag, branch })

        const summary = (base.content[0]?.text as string) ?? "agenda"
        const markdownFallback = (base.content[1]?.text as string) ?? ""

        const envelope = renderAgentSuccess({
          command,
          statusSummary: summary,
          result: markdownFallback || "No active todos in this window.",
        })

        // Replace the model-facing terse text with the envelope; keep the
        // user-facing markdown content block; keep structuredContent + _meta
        // untouched so the widget continues to render.
        return {
          ...base,
          content: [
            { type: "text" as const, text: envelope },
            base.content[1],
          ],
        }
      } catch (err) {
        return errorEnvelopeContent(command, err)
      }
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
