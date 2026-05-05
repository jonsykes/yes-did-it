/**
 * CLI integration tests — run the compiled ydi binary against a local API
 * server with test credentials (see global-setup.ts).
 *
 * All todos created during tests are cleaned up in afterAll + global teardown.
 */

import { spawnSync } from "child_process"
import { join } from "path"
import { describe, it, expect, afterAll } from "vitest"

const BIN = join(__dirname, "../../bin/run.js")
const createdTodoIds: string[] = []
const createdKeyIds: string[] = []

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function ydi(...args: string[]) {
  return spawnSync(process.execPath, [BIN, ...args], {
    encoding: "utf8",
    timeout: 15000,
    env: { ...process.env },
  })
}

function ydiJson<T>(...args: string[]): T {
  const result = ydi(...args, "--json")
  expect(result.status, `ydi ${args.join(" ")} --json failed:\n${result.stderr}`).toBe(0)
  return JSON.parse(result.stdout) as T
}

// ---------------------------------------------------------------------------
// Cleanup
// ---------------------------------------------------------------------------

afterAll(async () => {
  for (const id of createdTodoIds) {
    ydi("delete", id)
  }
  for (const id of createdKeyIds) {
    ydi("keys", "delete", id)
  }
})

// ---------------------------------------------------------------------------
// Help
// ---------------------------------------------------------------------------

describe("help", () => {
  it("ydi --help exits 0 and lists commands", () => {
    const result = ydi("--help")
    expect(result.status).toBe(0)
    expect(result.stdout).toContain("COMMANDS")
    expect(result.stdout).toContain("add")
    expect(result.stdout).toContain("list")
    expect(result.stdout).toContain("done")
    expect(result.stdout).toContain("delete")
    expect(result.stdout).toContain("update")
    expect(result.stdout).toContain("login")
    expect(result.stdout).toContain("keys")
  })

  it("ydi list --help exits 0", () => {
    const result = ydi("list", "--help")
    expect(result.status).toBe(0)
    expect(result.stdout).toContain("--json")
    expect(result.stdout).toContain("--filter")
  })

  it("ydi keys create --help exits 0", () => {
    const result = ydi("keys", "create", "--help")
    expect(result.status).toBe(0)
    expect(result.stdout).toContain("--name")
    expect(result.stdout).toContain("--expires")
  })
})

// ---------------------------------------------------------------------------
// List
// ---------------------------------------------------------------------------

describe("list", () => {
  it("returns a JSON array", () => {
    const todos = ydiJson<unknown[]>("list")
    expect(Array.isArray(todos)).toBe(true)
  })

  it("each todo has expected fields", () => {
    const todos = ydiJson<Record<string, unknown>[]>("list")
    if (todos.length === 0) return // nothing to assert
    const todo = todos[0]
    expect(todo).toHaveProperty("id")
    expect(todo).toHaveProperty("text")
    expect(todo).toHaveProperty("status")
    expect(todo).toHaveProperty("tags")
    expect(Array.isArray(todo.tags)).toBe(true)
  })

  it("--filter flag is accepted", () => {
    const result = ydi("list", "--filter", "today", "--json")
    expect(result.status).toBe(0)
    const todos = JSON.parse(result.stdout)
    expect(Array.isArray(todos)).toBe(true)
  })

  it("--done flag returns only completed todos", () => {
    const todos = ydiJson<Record<string, unknown>[]>("list", "--done")
    for (const todo of todos) {
      expect(todo.status).toBe("done")
    }
  })

  it("--all flag returns todos of any status", () => {
    const result = ydi("list", "--all", "--json")
    expect(result.status).toBe(0)
  })

  it("human-readable output (no --json) exits 0", () => {
    const result = ydi("list")
    expect(result.status).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// Todo lifecycle: add → list → done → delete
// ---------------------------------------------------------------------------

describe("todo lifecycle", () => {
  let todoId: string

  it("add creates a todo and returns JSON with an id", () => {
    const todo = ydiJson<{ id: string; text: string; status: string }>(
      "add",
      "[test] cli integration test todo"
    )
    expect(todo.id).toBeTruthy()
    expect(todo.text).toBe("[test] cli integration test todo")
    expect(todo.status).toBe("pending")
    todoId = todo.id
    createdTodoIds.push(todoId)
  })

  it("add with --due parses the date", () => {
    const todo = ydiJson<{ id: string; due_at: string | null }>(
      "add",
      "[test] cli test with due date",
      "--due",
      "tomorrow 9am"
    )
    expect(todo.due_at).not.toBeNull()
    createdTodoIds.push(todo.id)
  })

  it("add with --tag sets tags", () => {
    const todo = ydiJson<{ id: string; tags: string[] }>(
      "add",
      "[test] cli test with tag",
      "--tag",
      "ci-test"
    )
    expect(todo.tags).toContain("ci-test")
    createdTodoIds.push(todo.id)
  })

  it("the new todo appears in list", () => {
    const todos = ydiJson<{ id: string }[]>("list", "--all")
    const found = todos.find((t) => t.id === todoId)
    expect(found).toBeTruthy()
  })

  it("done marks the todo as completed", () => {
    const todo = ydiJson<{ id: string; status: string }>("done", todoId)
    expect(todo.status).toBe("done")
  })

  it("completed todo appears in --done list", () => {
    const todos = ydiJson<{ id: string }[]>("list", "--done")
    const found = todos.find((t) => t.id === todoId)
    expect(found).toBeTruthy()
  })

  it("delete removes the todo", () => {
    const result = ydi("delete", todoId)
    expect(result.status).toBe(0)
    // Remove from cleanup list since we already deleted it
    const idx = createdTodoIds.indexOf(todoId)
    if (idx !== -1) createdTodoIds.splice(idx, 1)
  })

  it("deleted todo no longer appears in list", () => {
    const todos = ydiJson<{ id: string }[]>("list", "--all")
    const found = todos.find((t) => t.id === todoId)
    expect(found).toBeUndefined()
  })
})

// ---------------------------------------------------------------------------
// Update
// ---------------------------------------------------------------------------

describe("update", () => {
  let todoId: string

  it("creates a todo to update", () => {
    const todo = ydiJson<{ id: string; text: string; tags: string[] }>(
      "add",
      "[test] update target",
      "--tag",
      "original"
    )
    todoId = todo.id
    createdTodoIds.push(todoId)
  })

  it("update --text changes the text", () => {
    const todo = ydiJson<{ id: string; text: string }>(
      "update",
      todoId,
      "--text",
      "[test] updated text"
    )
    expect(todo.text).toBe("[test] updated text")
  })

  it("update --due sets a due date", () => {
    const todo = ydiJson<{ id: string; due_at: string | null }>(
      "update",
      todoId,
      "--due",
      "tomorrow 9am"
    )
    expect(todo.due_at).not.toBeNull()
  })

  it("update --clear-due removes the due date", () => {
    const todo = ydiJson<{ id: string; due_at: string | null }>(
      "update",
      todoId,
      "--clear-due"
    )
    expect(todo.due_at).toBeNull()
  })

  it("update --tag replaces tags", () => {
    const todo = ydiJson<{ id: string; tags: string[] }>(
      "update",
      todoId,
      "--tag",
      "new-tag",
      "--tag",
      "another"
    )
    expect(todo.tags).toContain("new-tag")
    expect(todo.tags).toContain("another")
    expect(todo.tags).not.toContain("original")
  })

  it("update with short prefix works", () => {
    const shortId = todoId.slice(0, 8)
    const todo = ydiJson<{ id: string; text: string }>(
      "update",
      shortId,
      "--text",
      "[test] short prefix update"
    )
    expect(todo.text).toBe("[test] short prefix update")
  })

  it("update --clear-tags removes all tags", () => {
    // First set some tags
    ydiJson<{ id: string }>("update", todoId, "--tag", "temp-tag")
    // Then clear them
    const todo = ydiJson<{ id: string; tags: string[] }>(
      "update",
      todoId,
      "--clear-tags"
    )
    expect(todo.tags).toEqual([])
  })

  it("update --due and --clear-due together exits non-zero", () => {
    const result = ydi("update", todoId, "--due", "tomorrow", "--clear-due")
    expect(result.status).not.toBe(0)
  })

  it("update with no flags exits non-zero", () => {
    const result = ydi("update", todoId)
    expect(result.status).not.toBe(0)
  })

  it("human-readable output (no --json) exits 0", () => {
    const result = ydi("update", todoId, "--text", "[test] human readable update")
    expect(result.status).toBe(0)
    expect(result.stdout).toContain("Updated:")
  })
})

// ---------------------------------------------------------------------------
// Short ID prefix resolution
// ---------------------------------------------------------------------------

describe("short ID resolution", () => {
  let todoId: string
  let shortId: string

  it("creates a todo to test prefix resolution", () => {
    const todo = ydiJson<{ id: string }>("add", "[test] prefix resolution test")
    todoId = todo.id
    shortId = todoId.slice(0, 8)
    createdTodoIds.push(todoId)
  })

  it("done accepts a short prefix", () => {
    const result = ydi("done", shortId)
    expect(result.status).toBe(0)
  })

  it("delete accepts a short prefix", () => {
    const result = ydi("delete", shortId)
    expect(result.status).toBe(0)
    const idx = createdTodoIds.indexOf(todoId)
    if (idx !== -1) createdTodoIds.splice(idx, 1)
  })
})

// ---------------------------------------------------------------------------
// API keys lifecycle
// ---------------------------------------------------------------------------

describe("keys lifecycle", () => {
  let keyId: string

  it("keys create returns a key with ydi_live_ prefix", () => {
    const result = ydi("keys", "create", "--name", "[test] ci key", "--json")
    expect(result.status).toBe(0)
    const key = JSON.parse(result.stdout)
    expect(key.key).toMatch(/^ydi_live_/)
    expect(key.name).toBe("[test] ci key")
    keyId = key.id
    createdKeyIds.push(keyId)
  })

  it("keys list shows the created key", () => {
    const keys = ydiJson<{ id: string; name: string }[]>("keys", "list")
    const found = keys.find((k) => k.id === keyId)
    expect(found).toBeTruthy()
    expect(found?.name).toBe("[test] ci key")
  })

  it("keys list never shows the full key", () => {
    const keys = ydiJson<Record<string, unknown>[]>("keys", "list")
    for (const key of keys) {
      expect(key).not.toHaveProperty("key")
    }
  })

  it("keys delete removes the key", () => {
    const result = ydi("keys", "delete", keyId)
    expect(result.status).toBe(0)
    const idx = createdKeyIds.indexOf(keyId)
    if (idx !== -1) createdKeyIds.splice(idx, 1)
  })

  it("deleted key no longer appears in list", () => {
    const keys = ydiJson<{ id: string }[]>("keys", "list")
    const found = keys.find((k) => k.id === keyId)
    expect(found).toBeUndefined()
  })
})

// ---------------------------------------------------------------------------
// Standup
// ---------------------------------------------------------------------------

describe("standup", () => {
  it("ydi standup exits 0", () => {
    const result = ydi("standup")
    expect(result.status).toBe(0)
    expect(result.stdout).toContain("Standup")
  })

  it("ydi standup --json returns structured output", () => {
    const result = ydi("standup", "--json")
    expect(result.status).toBe(0)
    const data = JSON.parse(result.stdout)
    expect(data).toHaveProperty("since")
    expect(data).toHaveProperty("completed")
    expect(data).toHaveProperty("in_progress")
    expect(Array.isArray(data.completed)).toBe(true)
    expect(Array.isArray(data.in_progress)).toBe(true)
  })

  it("ydi standup --since '7 days ago' exits 0", () => {
    const result = ydi("standup", "--since", "7 days ago")
    expect(result.status).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// Active filter
// ---------------------------------------------------------------------------

describe("list --active", () => {
  it("ydi list --active exits 0", () => {
    const result = ydi("list", "--active")
    expect(result.status).toBe(0)
    expect(result.stdout).toContain("Active todos")
  })

  it("ydi list --active --json exits 0 and returns array", () => {
    const result = ydi("list", "--active", "--json")
    expect(result.status).toBe(0)
    const todos = JSON.parse(result.stdout)
    expect(Array.isArray(todos)).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// Error handling
// ---------------------------------------------------------------------------

describe("errors", () => {
  it("invalid --filter value exits non-zero", () => {
    const result = ydi("list", "--filter", "not-a-real-filter")
    expect(result.status).not.toBe(0)
  })

  it("add with unparseable --due exits non-zero", () => {
    const result = ydi("add", "test", "--due", "not a date at all xyz")
    expect(result.status).not.toBe(0)
  })

  it("done with a non-existent ID exits non-zero", () => {
    const result = ydi("done", "00000000-0000-0000-0000-000000000000")
    expect(result.status).not.toBe(0)
  })
})
