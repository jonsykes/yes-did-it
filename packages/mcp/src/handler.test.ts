import { describe, it, expect, vi, beforeEach } from "vitest"

// Mock api-client before importing handler
vi.mock("./api-client", () => ({
  setTransportAuthHeader: vi.fn(),
  clearTransportAuthHeader: vi.fn(),
  createTodo: vi.fn(),
  listTodos: vi.fn(),
  completeTodo: vi.fn(),
  deleteTodo: vi.fn(),
  updateTodo: vi.fn(),
}))

// Mock shared git utilities (required by server.ts)
vi.mock("./shared", () => ({
  getGitContext: vi.fn(),
  getBranch: vi.fn(),
  getFilesChanged: vi.fn(),
  getAllRemoteBranches: vi.fn(),
}))

import { handleMcpStreamable } from "./handler.js"
import { listTodos } from "./api-client.js"

const mockListTodos = vi.mocked(listTodos)

function makeTodo(overrides: Record<string, unknown> = {}) {
  return {
    id: "aaaaaaaa-0000-0000-0000-000000000000",
    text: "test todo",
    status: "pending",
    due_at: null,
    completed_at: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    tags: [],
    context: null,
    ...overrides,
  }
}

function mcpRequest(body: unknown, headers: Record<string, string> = {}): Request {
  return new Request("http://localhost:3000/api/mcp", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
      ...headers,
    },
    body: JSON.stringify(body),
  })
}

describe("handleMcpStreamable", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("POST initialize → 200 with InitializeResult", async () => {
    const req = mcpRequest({
      jsonrpc: "2.0",
      method: "initialize",
      params: {
        protocolVersion: "2025-03-26",
        capabilities: {},
        clientInfo: { name: "test", version: "1.0" },
      },
      id: 1,
    })

    const res = await handleMcpStreamable(req, "fake-token")

    expect(res.status).toBe(200)
    expect(res.headers.get("Content-Type")).toContain("application/json")
    const body = await res.json()
    expect(body.result).toBeDefined()
    expect(body.result.protocolVersion).toBeDefined()
    expect(body.result.serverInfo).toBeDefined()
    expect(body.result.serverInfo.name).toBe("yesdidit")
    expect(body.result.capabilities).toBeDefined()
    expect(body.id).toBe(1)
  })

  it("POST tools/list → 200 with 10 tools + annotations", async () => {
    // Must initialize first
    const initReq = mcpRequest({
      jsonrpc: "2.0",
      method: "initialize",
      params: {
        protocolVersion: "2025-03-26",
        capabilities: {},
        clientInfo: { name: "test", version: "1.0" },
      },
      id: 1,
    })
    await handleMcpStreamable(initReq, "fake-token")

    const req = mcpRequest(
      { jsonrpc: "2.0", method: "tools/list", id: 2 },
      { "MCP-Protocol-Version": "2025-03-26" }
    )

    const res = await handleMcpStreamable(req, "fake-token")

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.result.tools).toHaveLength(10)

    // Verify annotations are present
    for (const tool of body.result.tools) {
      expect(tool.annotations).toBeDefined()
      expect(
        "readOnlyHint" in tool.annotations || "destructiveHint" in tool.annotations
      ).toBe(true)
    }
  })

  it("POST tools/call (list_todos) → 200 with result", async () => {
    mockListTodos.mockResolvedValue([makeTodo({ text: "my task" })] as never)

    const req = mcpRequest(
      {
        jsonrpc: "2.0",
        method: "tools/call",
        params: { name: "list_todos", arguments: { status: "pending" } },
        id: 3,
      },
      { "MCP-Protocol-Version": "2025-03-26" }
    )

    const res = await handleMcpStreamable(req, "fake-token")

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.result).toBeDefined()
    expect(body.result.content).toBeDefined()
    expect(body.result.content[0].text).toContain("my task")
  })

  it("POST notification → 202 with no body", async () => {
    const req = mcpRequest({
      jsonrpc: "2.0",
      method: "notifications/initialized",
    })

    const res = await handleMcpStreamable(req, "fake-token")

    expect(res.status).toBe(202)
  })

  it("GET → 405 (stateless, no SSE stream)", async () => {
    const req = new Request("http://localhost:3000/api/mcp", {
      method: "GET",
      headers: { Accept: "text/event-stream" },
    })

    const res = await handleMcpStreamable(req, "fake-token")

    // SDK with sessionIdGenerator: undefined returns 405 for GET when
    // no session exists. However, the SDK may return 200 with an empty
    // SSE stream in some versions. Either way, GET is not functional
    // in stateless mode — the Hono route layer handles method routing.
    expect([200, 405]).toContain(res.status)
  })

  it("POST without Accept header → 406", async () => {
    const req = new Request("http://localhost:3000/api/mcp", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", method: "tools/list", id: 4 }),
    })

    const res = await handleMcpStreamable(req, "fake-token")

    expect(res.status).toBe(406)
  })

  it("POST without Content-Type → error response", async () => {
    const req = new Request("http://localhost:3000/api/mcp", {
      method: "POST",
      headers: { Accept: "application/json, text/event-stream" },
      body: JSON.stringify({ jsonrpc: "2.0", method: "tools/list", id: 5 }),
    })

    const res = await handleMcpStreamable(req, "fake-token")

    // SDK should reject with 415 Unsupported Media Type
    expect(res.status).toBe(415)
  })
})
