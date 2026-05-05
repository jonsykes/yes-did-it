import { describe, it, expect, vi, beforeEach } from "vitest"

// Mock api-client before importing server
vi.mock("./api-client", () => ({
  createTodo: vi.fn(),
  listTodos: vi.fn(),
  completeTodo: vi.fn(),
  deleteTodo: vi.fn(),
  updateTodo: vi.fn(),
}))

// Mock shared git utilities
vi.mock("./shared/index.js", () => ({
  getGitContext: vi.fn(),
  getBranch: vi.fn(),
  getFilesChanged: vi.fn(),
  getAllRemoteBranches: vi.fn(),
}))

import { createTodo, listTodos } from "./api-client.js"
import { getGitContext, getBranch, getFilesChanged, getAllRemoteBranches } from "./shared/index.js"
import { createMcpServer } from "./server.js"

const mockCreateTodo = vi.mocked(createTodo)
const mockListTodos = vi.mocked(listTodos)
const mockGetGitContext = vi.mocked(getGitContext)
const mockGetBranch = vi.mocked(getBranch)
const mockGetFilesChanged = vi.mocked(getFilesChanged)
const mockGetAllRemoteBranches = vi.mocked(getAllRemoteBranches)

type McpServerInternal = ReturnType<typeof createMcpServer> & {
  _registeredTools: Record<string, unknown>
  validateToolInput(tool: unknown, args: unknown, name: string): Promise<unknown>
  executeToolHandler(tool: unknown, args: unknown, extra: unknown): Promise<unknown>
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
  context: { branch?: string; commit?: string; repo?: string } | null
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

async function callTool(name: string, args: Record<string, unknown>) {
  const server = createMcpServer() as McpServerInternal
  const tool = server._registeredTools[name]
  const validatedArgs = await server.validateToolInput(tool, args, name)
  return server.executeToolHandler(tool, validatedArgs, {})
}

describe("add_todo tool", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("captures git context and passes it to createTodo", async () => {
    const gitContext = { branch: "feat/test", commit: "abc1234", repo: "github.com/owner/repo" }
    mockGetGitContext.mockReturnValue(gitContext)
    mockCreateTodo.mockResolvedValue(makeTodo({ text: "my task", context: gitContext }))

    await callTool("add_todo", { text: "my task" })

    expect(mockGetGitContext).toHaveBeenCalledWith(undefined)
    expect(mockCreateTodo).toHaveBeenCalledWith(
      expect.objectContaining({ text: "my task", context: gitContext })
    )
  })

  it("passes cwd override to getGitContext", async () => {
    mockGetGitContext.mockReturnValue(null)
    mockCreateTodo.mockResolvedValue(makeTodo({ text: "task" }))

    await callTool("add_todo", { text: "task", cwd: "/some/path" })

    expect(mockGetGitContext).toHaveBeenCalledWith("/some/path")
  })

  it("passes null context when not in a git repo", async () => {
    mockGetGitContext.mockReturnValue(null)
    mockCreateTodo.mockResolvedValue(makeTodo({ text: "task" }))

    await callTool("add_todo", { text: "task" })

    expect(mockCreateTodo).toHaveBeenCalledWith(
      expect.objectContaining({ context: null })
    )
  })

  it("includes branch in output when context has branch", async () => {
    const gitContext = { branch: "feat/branch-display" }
    mockGetGitContext.mockReturnValue(gitContext)
    mockCreateTodo.mockResolvedValue(makeTodo({ text: "task", context: gitContext }))

    const result = await callTool("add_todo", { text: "task" }) as { content: { text: string }[] }

    expect(result.content[0].text).toContain("[feat/branch-display]")
  })
})

describe("list_todos tool", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("passes branch param to listTodos", async () => {
    mockListTodos.mockResolvedValue([])

    await callTool("list_todos", { branch: "feat/test" })

    expect(mockListTodos).toHaveBeenCalledWith(
      expect.objectContaining({ branch: "feat/test" })
    )
  })

  it("passes repo param to listTodos", async () => {
    mockListTodos.mockResolvedValue([])

    await callTool("list_todos", { repo: "github.com/owner/repo" })

    expect(mockListTodos).toHaveBeenCalledWith(
      expect.objectContaining({ repo: "github.com/owner/repo" })
    )
  })

  it("shows branch in output when todo has context", async () => {
    mockListTodos.mockResolvedValue([
      makeTodo({ text: "branch task", context: { branch: "feat/display" } }),
    ])

    const result = await callTool("list_todos", {}) as { content: { text: string }[] }

    expect(result.content[0].text).toContain("[feat/display]")
  })

  it("returns no todos message when empty", async () => {
    mockListTodos.mockResolvedValue([])

    const result = await callTool("list_todos", {}) as { content: { text: string }[] }

    expect(result.content[0].text).toBe("No todos found.")
  })

  it("passes file param to listTodos", async () => {
    mockListTodos.mockResolvedValue([])

    await callTool("list_todos", { file: "src/auth.ts" })

    expect(mockListTodos).toHaveBeenCalledWith(
      expect.objectContaining({ file: "src/auth.ts" })
    )
  })

  it("passes tag param to listTodos", async () => {
    mockListTodos.mockResolvedValue([])

    await callTool("list_todos", { tag: "v2.1.0" })

    expect(mockListTodos).toHaveBeenCalledWith(
      expect.objectContaining({ tag: "v2.1.0" })
    )
  })
})

describe("list_file_todos tool", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("auto-detects changed files and lists matching todos", async () => {
    mockGetFilesChanged.mockReturnValue(["src/auth.ts", "src/middleware.ts"])
    mockListTodos.mockResolvedValue([
      makeTodo({ text: "fix auth", context: { files_changed: ["src/auth.ts"] } }),
    ])

    const result = await callTool("list_file_todos", {}) as { content: { text: string }[] }

    expect(mockGetFilesChanged).toHaveBeenCalledWith(undefined)
    expect(mockListTodos).toHaveBeenCalledWith(expect.objectContaining({ file: "src/auth.ts" }))
    expect(result.content[0].text).toContain("fix auth")
    expect(result.content[0].text).toContain("1 todo")
  })

  it("passes cwd override to getFilesChanged", async () => {
    mockGetFilesChanged.mockReturnValue(null)

    await callTool("list_file_todos", { cwd: "/custom/path" })

    expect(mockGetFilesChanged).toHaveBeenCalledWith("/custom/path")
  })

  it("returns message when no changed files", async () => {
    mockGetFilesChanged.mockReturnValue(null)

    const result = await callTool("list_file_todos", {}) as { content: { text: string }[] }

    expect(result.content[0].text).toContain("No changed files detected")
    expect(mockListTodos).not.toHaveBeenCalled()
  })

  it("returns message when no todos match changed files", async () => {
    mockGetFilesChanged.mockReturnValue(["src/unrelated.ts"])
    mockListTodos.mockResolvedValue([])

    const result = await callTool("list_file_todos", {}) as { content: { text: string }[] }

    expect(result.content[0].text).toContain("No todos found")
    expect(result.content[0].text).toContain("src/unrelated.ts")
  })
})

describe("list_branch_todos tool", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("auto-detects branch and lists matching todos", async () => {
    mockGetBranch.mockReturnValue("feat/my-feature")
    mockListTodos.mockResolvedValue([
      makeTodo({ text: "branch task" }),
    ])

    const result = await callTool("list_branch_todos", {}) as { content: { text: string }[] }

    expect(mockGetBranch).toHaveBeenCalledWith(undefined)
    expect(mockListTodos).toHaveBeenCalledWith(
      expect.objectContaining({ branch: "feat/my-feature" })
    )
    expect(result.content[0].text).toContain("feat/my-feature")
    expect(result.content[0].text).toContain("branch task")
  })

  it("passes cwd override to getBranch", async () => {
    mockGetBranch.mockReturnValue("main")
    mockListTodos.mockResolvedValue([])

    await callTool("list_branch_todos", { cwd: "/custom/path" })

    expect(mockGetBranch).toHaveBeenCalledWith("/custom/path")
  })

  it("returns error when not in a git repo", async () => {
    mockGetBranch.mockReturnValue(null)

    const result = await callTool("list_branch_todos", {}) as { content: { text: string }[] }

    expect(result.content[0].text).toContain("Not in a git repository")
    expect(mockListTodos).not.toHaveBeenCalled()
  })

  it("shows empty message when no todos on branch", async () => {
    mockGetBranch.mockReturnValue("feat/empty")
    mockListTodos.mockResolvedValue([])

    const result = await callTool("list_branch_todos", {}) as { content: { text: string }[] }

    expect(result.content[0].text).toContain("No todos found on branch: feat/empty")
  })
})

describe("standup tool", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("returns completed todos grouped by branch and in-progress summary", async () => {
    mockListTodos
      .mockResolvedValueOnce([
        makeTodo({ text: "fixed auth bug", status: "done", context: { branch: "feat/auth", pr: 42 } }),
        makeTodo({ id: "bbbbbbbb-0000-0000-0000-000000000000", text: "added tests", status: "done", context: { branch: "feat/auth" } }),
        makeTodo({ id: "cccccccc-0000-0000-0000-000000000000", text: "updated docs", status: "done" }),
      ])
      .mockResolvedValueOnce([
        makeTodo({ id: "dddddddd-0000-0000-0000-000000000000", text: "WIP feature", context: { branch: "feat/new" } }),
      ])

    const result = await callTool("standup", {}) as { content: { text: string }[] }

    expect(mockListTodos).toHaveBeenCalledWith(
      expect.objectContaining({ status: "done", completed_since: expect.any(String) })
    )
    expect(mockListTodos).toHaveBeenCalledWith(
      expect.objectContaining({ status: "pending", has_context: true })
    )
    expect(result.content[0].text).toContain("Completed:")
    expect(result.content[0].text).toContain("feat/auth (PR #42):")
    expect(result.content[0].text).toContain("- fixed auth bug")
    expect(result.content[0].text).toContain("- added tests")
    expect(result.content[0].text).toContain("(no branch):")
    expect(result.content[0].text).toContain("- updated docs")
    expect(result.content[0].text).toContain("In Progress:")
    expect(result.content[0].text).toContain("feat/new [1 todo]")
  })

  it("returns empty message when no todos", async () => {
    mockListTodos.mockResolvedValue([])

    const result = await callTool("standup", {}) as { content: { text: string }[] }

    expect(result.content[0].text).toContain("No completed or in-progress todos found.")
  })

  it("passes custom since param as completed_since", async () => {
    mockListTodos.mockResolvedValue([])

    await callTool("standup", { since: "2026-04-10T00:00:00Z" })

    expect(mockListTodos).toHaveBeenCalledWith(
      expect.objectContaining({ completed_since: "2026-04-10T00:00:00Z" })
    )
  })

  it("shows 'none' sections when one side is empty", async () => {
    mockListTodos
      .mockResolvedValueOnce([
        makeTodo({ text: "done task", status: "done", context: { branch: "feat/x" } }),
      ])
      .mockResolvedValueOnce([])

    const result = await callTool("standup", {}) as { content: { text: string }[] }

    expect(result.content[0].text).toContain("Completed:")
    expect(result.content[0].text).toContain("In Progress: none")
  })
})

describe("sweep_todos tool", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("returns stale todos when branch deleted from remote", async () => {
    mockListTodos.mockResolvedValue([
      makeTodo({ id: "11111111-0000-0000-0000-000000000000", text: "stale task", context: { branch: "feat/merged" } }),
      makeTodo({ id: "22222222-0000-0000-0000-000000000000", text: "active task", context: { branch: "feat/active" } }),
    ])
    mockGetAllRemoteBranches.mockReturnValue(new Set(["main", "feat/active"]))

    const result = await callTool("sweep_todos", {}) as { content: { text: string }[] }

    expect(result.content[0].text).toContain("1 stale todo")
    expect(result.content[0].text).toContain("stale task")
    expect(result.content[0].text).toContain("feat/merged")
    expect(result.content[0].text).not.toContain("active task")
  })

  it("returns no stale message when all branches active", async () => {
    mockListTodos.mockResolvedValue([
      makeTodo({ text: "active task", context: { branch: "feat/active" } }),
    ])
    mockGetAllRemoteBranches.mockReturnValue(new Set(["main", "feat/active"]))

    const result = await callTool("sweep_todos", {}) as { content: { text: string }[] }

    expect(result.content[0].text).toContain("No stale todos found")
  })

  it("returns error when remote unreachable", async () => {
    mockListTodos.mockResolvedValue([
      makeTodo({ text: "task", context: { branch: "feat/x" } }),
    ])
    mockGetAllRemoteBranches.mockReturnValue(new Set())

    const result = await callTool("sweep_todos", {}) as { content: { text: string }[] }

    expect(result.content[0].text).toContain("Could not reach remote")
  })

  it("returns message when no todos with context", async () => {
    mockListTodos.mockResolvedValue([])

    const result = await callTool("sweep_todos", {}) as { content: { text: string }[] }

    expect(result.content[0].text).toContain("No todos with branch context")
  })
})
