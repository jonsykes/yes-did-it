import { describe, it, expect, vi, beforeEach } from "vitest"

vi.mock("./api-client", () => ({
  listTodos: vi.fn(),
}))

import { listTodos, type Todo } from "./api-client.js"
import {
  getAgendaRows,
  buildAgendaResult,
  renderMarkdownAgenda,
  handleGetAgenda,
} from "./agenda.js"

const mockListTodos = vi.mocked(listTodos)

function makeTodo(overrides: Partial<Todo> & { id: string; text: string }): Todo {
  return {
    id: overrides.id,
    text: overrides.text,
    status: overrides.status ?? "pending",
    due_at: overrides.due_at ?? null,
    completed_at: overrides.completed_at ?? null,
    created_at: overrides.created_at ?? "2026-04-20T00:00:00.000Z",
    updated_at: overrides.updated_at ?? "2026-04-20T00:00:00.000Z",
    tags: overrides.tags ?? [],
    context: overrides.context ?? null,
  }
}

beforeEach(() => {
  mockListTodos.mockReset()
})

describe("getAgendaRows", () => {
  it("runs one listTodos call per bucket in parallel for the default window", async () => {
    mockListTodos.mockImplementation(async ({ filter }) => {
      if (filter === "overdue") return [makeTodo({ id: "11111111-1111-1111-1111-111111111111", text: "late" })]
      if (filter === "today") return [makeTodo({ id: "22222222-2222-2222-2222-222222222222", text: "now" })]
      return []
    })
    const rows = await getAgendaRows({})
    expect(mockListTodos).toHaveBeenCalledTimes(2)
    const filters = mockListTodos.mock.calls.map((c) => c[0].filter)
    expect(filters.sort()).toEqual(["overdue", "today"])
    expect(rows.map((r) => r.bucket).sort()).toEqual(["overdue", "today"])
  })

  it("window=this-week fetches all three buckets", async () => {
    mockListTodos.mockResolvedValue([])
    await getAgendaRows({ window: "this-week" })
    expect(mockListTodos).toHaveBeenCalledTimes(3)
    const filters = mockListTodos.mock.calls.map((c) => c[0].filter).sort()
    expect(filters).toEqual(["overdue", "this-week", "today"])
  })

  it("window=today fetches only today", async () => {
    mockListTodos.mockResolvedValue([])
    await getAgendaRows({ window: "today" })
    expect(mockListTodos).toHaveBeenCalledTimes(1)
    expect(mockListTodos.mock.calls[0][0].filter).toBe("today")
  })

  it("passes pending/limit/tag/branch through to listTodos", async () => {
    mockListTodos.mockResolvedValue([])
    await getAgendaRows({ window: "today", tag: "p0", branch: "feat/x" })
    expect(mockListTodos).toHaveBeenCalledWith({
      filter: "today",
      status: "pending",
      limit: 200,
      tag: "p0",
      branch: "feat/x",
    })
  })

  it("dedupes duplicate todos across buckets with overdue > today > week priority", async () => {
    const dup = makeTodo({ id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa", text: "edge-of-day" })
    mockListTodos.mockImplementation(async ({ filter }) => {
      if (filter === "overdue") return [dup]
      if (filter === "today") return [dup]
      if (filter === "this-week") return [dup]
      return []
    })
    const rows = await getAgendaRows({ window: "this-week" })
    expect(rows).toHaveLength(1)
    expect(rows[0].bucket).toBe("overdue")
  })

  it("maps git context onto branch and repo_slug", async () => {
    mockListTodos.mockImplementation(async ({ filter }) => {
      if (filter !== "today") return []
      return [
        makeTodo({
          id: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
          text: "has context",
          context: { branch: "feat/agenda-widget", repo: "jonsykes/Yesdidit" },
        }),
      ]
    })
    const [row] = await getAgendaRows({ window: "today" })
    expect(row.branch).toBe("feat/agenda-widget")
    expect(row.repo_slug).toBe("jonsykes/Yesdidit")
  })
})

describe("buildAgendaResult", () => {
  const rows = [
    {
      id: "11111111-1111-1111-1111-111111111111",
      text: "late",
      due_at: null,
      bucket: "overdue" as const,
      tags: [],
      branch: null,
      repo_slug: null,
    },
    {
      id: "22222222-2222-2222-2222-222222222222",
      text: "now",
      due_at: null,
      bucket: "today" as const,
      tags: [],
      branch: null,
      repo_slug: null,
    },
    {
      id: "33333333-3333-3333-3333-333333333333",
      text: "soon",
      due_at: null,
      bucket: "week" as const,
      tags: [],
      branch: null,
      repo_slug: null,
    },
  ]

  it("emits the three channels", () => {
    const result = buildAgendaResult(rows)

    // Two text content blocks — the host fetches the widget resource
    // separately via _meta.ui.resourceUri on the tool registration.
    expect(result.content).toHaveLength(2)

    // Channel 1: terse text for the model
    expect(result.content[0].type).toBe("text")
    expect(result.content[0].text).toContain("3 active todos")
    expect(result.content[0].text).toContain("1 overdue")

    // Channel 1 (fallback): markdown with audience=user so the model skips it
    expect(result.content[1].type).toBe("text")
    expect(result.content[1].annotations?.audience).toEqual(["user"])
    expect(result.content[1].text).toContain("🔴 Overdue")
    expect(result.content[1].text).toContain("📅 Today")
    expect(result.content[1].text).toContain("🗓 This week")

    // Channel 2: structured aggregates
    expect(result.structuredContent).toEqual({
      summary: "3 active todos",
      counts: { overdue: 1, today: 1, this_week: 1 },
    })

    // Channel 3: widget-only payload (no dotted ui.resourceUri — that lives
    // on the tool registration's _meta.ui.resourceUri now)
    expect("ui.resourceUri" in result._meta).toBe(false)
    expect(result._meta["ydi.todos"]).toHaveLength(3)
    expect(result._meta["ydi.todos"].map((r) => r.bucket).sort()).toEqual([
      "overdue",
      "today",
      "week",
    ])
    expect(typeof result._meta["ydi.server_time"]).toBe("string")
  })
})

describe("renderMarkdownAgenda", () => {
  it("groups by bucket and shows a section per non-empty bucket", () => {
    const md = renderMarkdownAgenda([
      {
        id: "11111111-1111-1111-1111-111111111111",
        text: "late",
        due_at: "2026-04-20T00:00:00.000Z",
        bucket: "overdue",
        tags: [],
        branch: null,
        repo_slug: null,
      },
    ])
    expect(md).toContain("### 🔴 Overdue")
    expect(md).toContain("- [ ] late")
    expect(md).toContain("_(111111)_")
    expect(md).toContain("due 2026-04-20T00:00:00.000Z")
    expect(md).not.toContain("📅 Today")
    expect(md).not.toContain("🗓 This week")
  })

  it("returns a friendly message when there are no rows", () => {
    expect(renderMarkdownAgenda([])).toBe("No active todos in this window.")
  })
})

describe("handleGetAgenda (end-to-end via mocked listTodos)", () => {
  it("returns a valid three-channel result", async () => {
    mockListTodos.mockImplementation(async ({ filter }) => {
      if (filter === "overdue") {
        return [makeTodo({ id: "11111111-1111-1111-1111-111111111111", text: "late" })]
      }
      if (filter === "today") {
        return [makeTodo({ id: "22222222-2222-2222-2222-222222222222", text: "now" })]
      }
      return []
    })
    const result = await handleGetAgenda({})
    expect(result.content).toHaveLength(2)
    expect(result.structuredContent.counts).toEqual({ overdue: 1, today: 1, this_week: 0 })
    expect(result._meta["ydi.todos"]).toHaveLength(2)
  })
})
