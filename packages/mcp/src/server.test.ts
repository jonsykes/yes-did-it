import { describe, it, expect, vi, beforeEach } from "vitest"

// Mock api-client before importing server
vi.mock("./api-client", () => ({
  createTodo: vi.fn(),
  listTodos: vi.fn(),
  listTodosPage: vi.fn(),
  completeTodo: vi.fn(),
  deleteTodo: vi.fn(),
  updateTodo: vi.fn(),
  findTodoByIdOrPrefix: vi.fn(),
}))

// Mock shared git utilities (but keep the agent-output helpers intact)
vi.mock("./shared/index.js", async () => {
  const real = await vi.importActual<typeof import("./shared/index.js")>("./shared/index.js")
  return {
    ...real,
    getGitContext: vi.fn(),
    getBranch: vi.fn(),
    getFilesChanged: vi.fn(),
    getAllRemoteBranches: vi.fn(),
  }
})

import {
  createTodo,
  listTodos,
  listTodosPage,
  completeTodo,
  deleteTodo,
  updateTodo,
  findTodoByIdOrPrefix,
} from "./api-client.js"
import {
  getGitContext,
  getBranch,
  getFilesChanged,
  getAllRemoteBranches,
} from "./shared/index.js"
import { createMcpServer } from "./server.js"

const mockCreateTodo = vi.mocked(createTodo)
const mockListTodos = vi.mocked(listTodos)
const mockListTodosPage = vi.mocked(listTodosPage)
const mockCompleteTodo = vi.mocked(completeTodo)
const mockDeleteTodo = vi.mocked(deleteTodo)
const mockUpdateTodo = vi.mocked(updateTodo)
const mockFindTodoByIdOrPrefix = vi.mocked(findTodoByIdOrPrefix)
const mockGetGitContext = vi.mocked(getGitContext)
const mockGetBranch = vi.mocked(getBranch)
const mockGetFilesChanged = vi.mocked(getFilesChanged)
const mockGetAllRemoteBranches = vi.mocked(getAllRemoteBranches)

type McpServerInternal = ReturnType<typeof createMcpServer> & {
  _registeredTools: Record<string, unknown>
  validateToolInput(tool: unknown, args: unknown, name: string): Promise<unknown>
  executeToolHandler(tool: unknown, args: unknown, extra: unknown): Promise<unknown>
}

type ToolResult = {
  content: Array<{ type: "text"; text: string }>
  isError?: boolean
  structuredContent?: unknown
  _meta?: Record<string, unknown>
}

function makeTodo(overrides: Partial<{
  id: string
  text: string
  status: "pending" | "done"
  due_at: string | null
  completed_at: string | null
  created_at: string
  updated_at: string
  tags: string[]
  context: { branch?: string; commit?: string; repo?: string; pr?: number } | null
}> = {}) {
  return {
    id: "aaaaaaaa-0000-0000-0000-000000000000",
    text: "test todo",
    status: "pending" as const,
    due_at: null,
    completed_at: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    tags: [],
    context: null,
    ...overrides,
  }
}

async function callTool(name: string, args: Record<string, unknown>): Promise<ToolResult> {
  const server = createMcpServer() as McpServerInternal
  const tool = server._registeredTools[name]
  const validatedArgs = await server.validateToolInput(tool, args, name)
  return (await server.executeToolHandler(tool, validatedArgs, {})) as ToolResult
}

function envelopeText(result: ToolResult): string {
  expect(result.content[0]?.type).toBe("text")
  return result.content[0].text
}

function expectEnvelope(text: string) {
  expect(text).toMatch(/^# /)
  expect(text).toContain("## Status")
  expect(text).toContain("## Result")
  expect(text).toContain("## Errors")
  expect(text).toContain("## Meta")
  expect(text).toContain("agent-output/v1")
}

// ── add_todo ───────────────────────────────────────────────────────────────

describe("add_todo tool", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("dry-runs without confirm (does NOT create) and renders envelope", async () => {
    mockGetGitContext.mockReturnValue({ branch: "feat/test" })

    const result = await callTool("add_todo", { text: "my task" })

    const text = envelopeText(result)
    expectEnvelope(text)
    expect(text).toContain("Dry-run")
    expect(text).toContain("Would create todo")
    expect(text).toContain("my task")
    expect(text).toContain("**branch:** feat/test")
    expect(text).toContain("## Actions")
    expect(text).toContain("confirm: true")
    expect(mockCreateTodo).not.toHaveBeenCalled()
  })

  it("with confirm:true creates the todo and renders Success", async () => {
    const gitContext = { branch: "feat/test", commit: "abc1234" }
    mockGetGitContext.mockReturnValue(gitContext)
    mockCreateTodo.mockResolvedValue(makeTodo({ text: "my task", context: gitContext }))

    const result = await callTool("add_todo", { text: "my task", confirm: true })

    expect(mockCreateTodo).toHaveBeenCalledWith(
      expect.objectContaining({ text: "my task", context: gitContext })
    )
    const text = envelopeText(result)
    expectEnvelope(text)
    expect(text).toContain("Success")
    expect(text).toContain("Created todo aaaaaaaa")
    expect(text).toContain("complete_todo")
  })

  it("passes cwd override to getGitContext under confirm", async () => {
    mockGetGitContext.mockReturnValue(null)
    mockCreateTodo.mockResolvedValue(makeTodo({ text: "task" }))

    await callTool("add_todo", { text: "task", cwd: "/some/path", confirm: true })

    expect(mockGetGitContext).toHaveBeenCalledWith("/some/path")
  })

  it("passes null context when not in a git repo (confirm)", async () => {
    mockGetGitContext.mockReturnValue(null)
    mockCreateTodo.mockResolvedValue(makeTodo({ text: "task" }))

    await callTool("add_todo", { text: "task", confirm: true })

    expect(mockCreateTodo).toHaveBeenCalledWith(
      expect.objectContaining({ context: null })
    )
  })
})

// ── list_todos ─────────────────────────────────────────────────────────────

describe("list_todos tool", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("passes branch param and renders an envelope with table rows", async () => {
    mockListTodosPage.mockResolvedValue({
      todos: [
        makeTodo({ text: "branch task", context: { branch: "feat/display" } }),
      ],
      cursor: null,
    })

    const result = await callTool("list_todos", { branch: "feat/test" })

    expect(mockListTodosPage).toHaveBeenCalledWith(
      expect.objectContaining({ branch: "feat/test" })
    )
    const text = envelopeText(result)
    expectEnvelope(text)
    expect(text).toContain("1 todo")
    expect(text).toContain("branch task")
    expect(text).toContain("feat/display")
    // markdown table header
    expect(text).toMatch(/\|\s*id\s*\|/)
  })

  it("renders an empty-state envelope when there are no matches", async () => {
    mockListTodosPage.mockResolvedValue({ todos: [], cursor: null })

    const result = await callTool("list_todos", {})

    const text = envelopeText(result)
    expectEnvelope(text)
    expect(text).toContain("Success")
    expect(text).toContain("0 todos")
    expect(text).toContain("No todos match")
  })

  it("passes file param and tag param through", async () => {
    mockListTodosPage.mockResolvedValue({ todos: [], cursor: null })

    await callTool("list_todos", { file: "src/auth.ts" })
    await callTool("list_todos", { tag: "v2.1.0" })

    expect(mockListTodosPage).toHaveBeenCalledWith(expect.objectContaining({ file: "src/auth.ts" }))
    expect(mockListTodosPage).toHaveBeenCalledWith(expect.objectContaining({ tag: "v2.1.0" }))
  })

  it("surfaces next_cursor in Meta and Actions when more pages exist", async () => {
    mockListTodosPage.mockResolvedValue({
      todos: [makeTodo({ text: "page 1" })],
      cursor: "50",
    })

    const result = await callTool("list_todos", { limit: 50 })
    const text = envelopeText(result)
    expect(text).toContain("next_cursor: 50")
    expect(text).toMatch(/Next page: `list_todos\(\{cursor: "50"/)
  })
})

// ── complete_todo ──────────────────────────────────────────────────────────

describe("complete_todo tool", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("without confirm renders dry-run envelope showing target", async () => {
    mockFindTodoByIdOrPrefix.mockResolvedValue(
      makeTodo({ id: "abcdef12-0000-0000-0000-000000000000", text: "to be done" })
    )

    const result = await callTool("complete_todo", { id: "abcdef12" })

    const text = envelopeText(result)
    expectEnvelope(text)
    expect(text).toContain("Dry-run")
    expect(text).toContain("Would mark this todo done")
    expect(text).toContain("to be done")
    expect(text).toContain("confirm: true")
    expect(mockCompleteTodo).not.toHaveBeenCalled()
  })

  it("with confirm:true marks done and renders Success", async () => {
    mockCompleteTodo.mockResolvedValue(
      makeTodo({ id: "abcdef12-0000-0000-0000-000000000000", text: "to be done", status: "done" })
    )

    const result = await callTool("complete_todo", { id: "abcdef12", confirm: true })

    expect(mockCompleteTodo).toHaveBeenCalledWith("abcdef12")
    const text = envelopeText(result)
    expectEnvelope(text)
    expect(text).toContain("Success")
    expect(text).toContain("Completed abcdef12")
  })

  it("emits NOT_FOUND error envelope when id does not exist (dry-run path)", async () => {
    mockFindTodoByIdOrPrefix.mockRejectedValue(new Error('No todo found matching "zzz"'))

    const result = await callTool("complete_todo", { id: "zzz" })

    expect(result.isError).toBe(true)
    const text = envelopeText(result)
    expectEnvelope(text)
    expect(text).toContain("Error (exit 3)")
    expect(text).toContain("NOT_FOUND")
  })
})

// ── delete_todo ────────────────────────────────────────────────────────────

describe("delete_todo tool", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("without confirm renders dry-run with deletion warning", async () => {
    mockFindTodoByIdOrPrefix.mockResolvedValue(
      makeTodo({ id: "11111111-0000-0000-0000-000000000000", text: "doomed" })
    )

    const result = await callTool("delete_todo", { id: "11111111" })

    const text = envelopeText(result)
    expectEnvelope(text)
    expect(text).toContain("Dry-run")
    expect(text).toContain("Would delete this todo")
    expect(text).toContain("doomed")
    expect(text).toContain("## Warnings")
    expect(text).toContain("irreversible")
    expect(mockDeleteTodo).not.toHaveBeenCalled()
  })

  it("with confirm:true deletes and renders Success", async () => {
    mockDeleteTodo.mockResolvedValue(undefined)

    const result = await callTool("delete_todo", { id: "11111111", confirm: true })

    expect(mockDeleteTodo).toHaveBeenCalledWith("11111111")
    const text = envelopeText(result)
    expectEnvelope(text)
    expect(text).toContain("Success")
    expect(text).toContain("Deleted 11111111")
  })
})

// ── update_todo ────────────────────────────────────────────────────────────

describe("update_todo tool", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("without confirm shows the diff in the dry-run envelope", async () => {
    mockFindTodoByIdOrPrefix.mockResolvedValue(
      makeTodo({ id: "abcdef12-0000-0000-0000-000000000000", text: "old text" })
    )

    const result = await callTool("update_todo", { id: "abcdef12", text: "new text" })

    const text = envelopeText(result)
    expectEnvelope(text)
    expect(text).toContain("Dry-run")
    expect(text).toContain("Would update")
    expect(text).toContain('text: "old text" → "new text"')
    expect(mockUpdateTodo).not.toHaveBeenCalled()
  })

  it("with confirm:true updates and renders Success", async () => {
    mockUpdateTodo.mockResolvedValue(
      makeTodo({ id: "abcdef12-0000-0000-0000-000000000000", text: "new text" })
    )

    const result = await callTool("update_todo", {
      id: "abcdef12",
      text: "new text",
      confirm: true,
    })

    expect(mockUpdateTodo).toHaveBeenCalledWith(
      "abcdef12",
      expect.objectContaining({ text: "new text" })
    )
    const text = envelopeText(result)
    expectEnvelope(text)
    expect(text).toContain("Success")
    expect(text).toContain("Updated abcdef12")
  })
})

// ── input validation ───────────────────────────────────────────────────────

describe("input validation (zod tightening)", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("rejects path-traversal-shaped ids", async () => {
    await expect(callTool("complete_todo", { id: "../etc/passwd" })).rejects.toThrow()
  })

  it("rejects ids with embedded query params", async () => {
    await expect(callTool("complete_todo", { id: "abc?status=done" })).rejects.toThrow()
  })

  it("rejects empty text on add_todo", async () => {
    await expect(callTool("add_todo", { text: "" })).rejects.toThrow()
  })

  it("rejects control characters in text", async () => {
    await expect(callTool("add_todo", { text: "hello\u0007world" })).rejects.toThrow()
  })
})

// ── list_branch_todos ──────────────────────────────────────────────────────

describe("list_branch_todos tool", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("auto-detects branch and lists matching todos", async () => {
    mockGetBranch.mockReturnValue("feat/my-feature")
    mockListTodos.mockResolvedValue([makeTodo({ text: "branch task" })])

    const result = await callTool("list_branch_todos", {})

    expect(mockGetBranch).toHaveBeenCalledWith(undefined)
    expect(mockListTodos).toHaveBeenCalledWith(
      expect.objectContaining({ branch: "feat/my-feature" })
    )
    const text = envelopeText(result)
    expectEnvelope(text)
    expect(text).toContain("feat/my-feature")
    expect(text).toContain("branch task")
  })

  it("emits a USAGE_ERROR envelope when not in a git repo", async () => {
    mockGetBranch.mockReturnValue(null)

    const result = await callTool("list_branch_todos", {})

    const text = envelopeText(result)
    expectEnvelope(text)
    expect(text).toContain("Error (exit 2)")
    expect(text).toContain("USAGE_ERROR")
    expect(mockListTodos).not.toHaveBeenCalled()
  })

  it("shows empty success envelope when no todos on branch", async () => {
    mockGetBranch.mockReturnValue("feat/empty")
    mockListTodos.mockResolvedValue([])

    const result = await callTool("list_branch_todos", {})

    const text = envelopeText(result)
    expectEnvelope(text)
    expect(text).toContain("Success")
    expect(text).toContain("0 todos on feat/empty")
  })
})

// ── list_file_todos ────────────────────────────────────────────────────────

describe("list_file_todos tool", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("auto-detects changed files and renders matching todos", async () => {
    mockGetFilesChanged.mockReturnValue(["src/auth.ts", "src/middleware.ts"])
    mockListTodos.mockResolvedValue([
      makeTodo({ text: "fix auth", context: { branch: "feat/x" } }),
    ])

    const result = await callTool("list_file_todos", {})

    expect(mockGetFilesChanged).toHaveBeenCalledWith(undefined)
    const text = envelopeText(result)
    expectEnvelope(text)
    expect(text).toContain("fix auth")
    expect(text).toContain("1 todo")
  })

  it("returns success envelope when no changed files", async () => {
    mockGetFilesChanged.mockReturnValue(null)

    const result = await callTool("list_file_todos", {})

    const text = envelopeText(result)
    expectEnvelope(text)
    expect(text).toContain("No changed files")
    expect(mockListTodos).not.toHaveBeenCalled()
  })
})

// ── standup ────────────────────────────────────────────────────────────────

describe("standup tool", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("returns envelope with completed grouped by branch and in-progress summary", async () => {
    mockListTodos
      .mockResolvedValueOnce([
        makeTodo({ text: "fixed auth bug", status: "done", context: { branch: "feat/auth", pr: 42 } }),
        makeTodo({
          id: "bbbbbbbb-0000-0000-0000-000000000000",
          text: "added tests",
          status: "done",
          context: { branch: "feat/auth" },
        }),
        makeTodo({
          id: "cccccccc-0000-0000-0000-000000000000",
          text: "updated docs",
          status: "done",
        }),
      ])
      .mockResolvedValueOnce([
        makeTodo({
          id: "dddddddd-0000-0000-0000-000000000000",
          text: "WIP feature",
          context: { branch: "feat/new" },
        }),
      ])

    const result = await callTool("standup", {})

    const text = envelopeText(result)
    expectEnvelope(text)
    expect(text).toContain("feat/auth (PR #42)")
    expect(text).toContain("- fixed auth bug")
    expect(text).toContain("- added tests")
    expect(text).toContain("(no branch)")
    expect(text).toContain("- updated docs")
    expect(text).toContain("In progress")
    expect(text).toContain("feat/new")
  })

  it("returns empty envelope when no todos", async () => {
    mockListTodos.mockResolvedValue([])

    const result = await callTool("standup", {})

    const text = envelopeText(result)
    expectEnvelope(text)
    expect(text).toContain("No completed or in-progress todos found.")
  })

  it("passes custom since param as completed_since", async () => {
    mockListTodos.mockResolvedValue([])

    await callTool("standup", { since: "2026-04-10T00:00:00Z" })

    expect(mockListTodos).toHaveBeenCalledWith(
      expect.objectContaining({ completed_since: "2026-04-10T00:00:00Z" })
    )
  })
})

// ── sweep_todos ────────────────────────────────────────────────────────────

describe("sweep_todos tool", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("returns stale todos envelope when branch deleted from remote", async () => {
    mockListTodos.mockResolvedValue([
      makeTodo({
        id: "11111111-0000-0000-0000-000000000000",
        text: "stale task",
        context: { branch: "feat/merged" },
      }),
      makeTodo({
        id: "22222222-0000-0000-0000-000000000000",
        text: "active task",
        context: { branch: "feat/active" },
      }),
    ])
    mockGetAllRemoteBranches.mockReturnValue(new Set(["main", "feat/active"]))

    const result = await callTool("sweep_todos", {})

    const text = envelopeText(result)
    expectEnvelope(text)
    expect(text).toContain("1 stale")
    expect(text).toContain("stale task")
    expect(text).toContain("feat/merged")
    expect(text).not.toContain("active task")
  })

  it("returns no-stale envelope when all branches active", async () => {
    mockListTodos.mockResolvedValue([
      makeTodo({ text: "active task", context: { branch: "feat/active" } }),
    ])
    mockGetAllRemoteBranches.mockReturnValue(new Set(["main", "feat/active"]))

    const result = await callTool("sweep_todos", {})

    const text = envelopeText(result)
    expectEnvelope(text)
    expect(text).toContain("No stale todos found")
  })

  it("emits a TIMEOUT error envelope when remote unreachable", async () => {
    mockListTodos.mockResolvedValue([
      makeTodo({ text: "task", context: { branch: "feat/x" } }),
    ])
    mockGetAllRemoteBranches.mockReturnValue(new Set())

    const result = await callTool("sweep_todos", {})

    const text = envelopeText(result)
    expectEnvelope(text)
    expect(text).toContain("Error (exit 7)")
    expect(text).toContain("TIMEOUT")
    expect(text).toContain("Could not reach remote")
  })
})
