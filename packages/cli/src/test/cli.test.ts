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

// ---------------------------------------------------------------------------
// Agent envelope (read-only commands)
// ---------------------------------------------------------------------------

function expectEnvelope(stdout: string, command: string) {
  expect(stdout, "envelope command header").toContain(`# ${command}`)
  expect(stdout, "envelope status").toMatch(/## Status\n(Success|Error|Partial|Dry-run) \(exit \d+\)/)
  expect(stdout, "envelope result").toContain("## Result")
  expect(stdout, "envelope errors").toContain("## Errors")
  expect(stdout, "envelope meta").toContain("## Meta")
  expect(stdout, "agent-output version").toContain("agent-output/v1")
}

describe("agent envelope: list", () => {
  it("ydi list --agent exits 0 and emits a well-formed envelope", () => {
    const result = ydi("list", "--agent")
    expect(result.status).toBe(0)
    expectEnvelope(result.stdout, "ydi list")
    expect(result.stdout).toContain("## Actions")
  })

  it("ydi list --agent renders a markdown table when results exist", () => {
    // Seed at least one todo so the table has rows
    const todo = ydiJson<{ id: string }>("add", "[test] envelope row")
    createdTodoIds.push(todo.id)

    const result = ydi("list", "--agent", "--all")
    expect(result.status).toBe(0)
    expect(result.stdout).toMatch(/\| id \| status \| text \|/)
    expect(result.stdout).toContain(todo.id.slice(0, 8))
  })

  it("ydi list --agent --fields restricts the columns", () => {
    const result = ydi("list", "--agent", "--fields", "id,text")
    expect(result.status).toBe(0)
    expect(result.stdout).toContain("| id | text |")
    // status header should not appear when not in fields
    expect(result.stdout).not.toMatch(/\| id \| text \| status \|/)
  })

  it("--agent wins over --json (envelope, not JSON)", () => {
    const result = ydi("list", "--agent", "--json")
    expect(result.status).toBe(0)
    // JSON would start with [ — envelope starts with #
    expect(result.stdout.trimStart().startsWith("#")).toBe(true)
  })

  it("token budget: 25-row list --agent fits within budget", () => {
    // Create 5 todos so even smaller envelopes have content
    const ids = []
    for (let i = 0; i < 5; i++) {
      const t = ydiJson<{ id: string }>("add", `[test] budget row ${i}`)
      ids.push(t.id)
      createdTodoIds.push(t.id)
    }
    const result = ydi("list", "--agent", "--limit", "25")
    expect(result.status).toBe(0)
    // Approx token count = chars/4. Loose budget: 4000 chars / ~1000 tokens.
    expect(result.stdout.length).toBeLessThan(8000)
    // Compare against --json equivalent — envelope should be at most modestly larger for tiny lists.
    const json = ydi("list", "--json", "--limit", "25")
    expect(json.status).toBe(0)
    // For 5+ rows the markdown table should be no larger than 2x the json
    expect(result.stdout.length).toBeLessThan(json.stdout.length * 2 + 800)
  })
})

describe("agent envelope: standup", () => {
  it("ydi standup --agent emits the envelope", () => {
    const result = ydi("standup", "--agent")
    expect(result.status).toBe(0)
    expectEnvelope(result.stdout, "ydi standup")
    expect(result.stdout).toContain("### Completed")
    expect(result.stdout).toContain("### In Progress")
  })

  it("ydi standup --since invalid --agent emits an error envelope", () => {
    const result = ydi("standup", "--since", "totally not a date xyz", "--agent")
    expect(result.status).not.toBe(0)
    expect(result.stdout).toContain("## Status\nError")
    expect(result.stdout).toContain("**Code:**")
  })
})

describe("agent envelope: context", () => {
  it("ydi context --agent emits the envelope", () => {
    const result = ydi("context", "--agent")
    expect(result.status).toBe(0)
    expectEnvelope(result.stdout, "ydi context")
  })
})

describe("agent envelope: config", () => {
  it("ydi config list --agent emits the envelope with table", () => {
    const result = ydi("config", "list", "--agent")
    expect(result.status).toBe(0)
    expectEnvelope(result.stdout, "ydi config list")
    expect(result.stdout).toContain("| key | value | source |")
  })

  it("ydi config get <key> --agent emits the envelope", () => {
    const result = ydi("config", "get", "timezone", "--agent")
    expect(result.status).toBe(0)
    expectEnvelope(result.stdout, "ydi config get timezone")
    expect(result.stdout).toContain("- **key:** timezone")
  })

  it("ydi config get <unknown-key> --agent emits an error envelope with exit 1", () => {
    const result = ydi("config", "get", "not-a-real-setting", "--agent")
    expect(result.status).not.toBe(0)
    expect(result.stdout).toContain("## Status\nError")
    expect(result.stdout).toContain("**Code:**")
  })
})

describe("agent envelope: keys list", () => {
  it("ydi keys list --agent emits the envelope", () => {
    const result = ydi("keys", "list", "--agent")
    expect(result.status).toBe(0)
    expectEnvelope(result.stdout, "ydi keys list")
  })
})

describe("agent envelope: hooks status", () => {
  it("ydi hooks status --agent emits the envelope (in a git repo)", () => {
    // The CLI test env runs from the repo root which IS a git repo.
    const result = ydi("hooks", "status", "--agent")
    // Either succeeds (in repo) or returns the structured error envelope
    expectEnvelope(result.stdout, "ydi hooks status")
  })
})

// ---------------------------------------------------------------------------
// Agent envelope (mutating commands — dry-run vs --confirm)
// ---------------------------------------------------------------------------

describe("agent envelope: add --agent dry-run vs --confirm", () => {
  it("ydi add --agent without --confirm renders dry-run and does NOT create a todo", () => {
    const before = ydiJson<{ id: string }[]>("list", "--all")
    const result = ydi("add", "[test] dry-run-add", "--agent")
    expect(result.status).toBe(0)
    expectEnvelope(result.stdout, 'ydi add "[test] dry-run-add" --agent')
    expect(result.stdout).toContain("## Status\nDry-run")
    expect(result.stdout).toContain("## Actions")
    expect(result.stdout).toContain("--confirm")
    const after = ydiJson<{ id: string }[]>("list", "--all")
    // No new todo with the dry-run text should exist
    const found = after.find((t) => (t as { text?: string }).text === "[test] dry-run-add")
    expect(found).toBeUndefined()
    expect(after.length).toBe(before.length)
  })

  it("ydi add --agent --confirm creates the todo and renders Success", () => {
    const result = ydi("add", "[test] confirm-add", "--agent", "--confirm")
    expect(result.status).toBe(0)
    expectEnvelope(result.stdout, 'ydi add "[test] confirm-add" --agent')
    expect(result.stdout).toContain("## Status\nSuccess")
    // Track for cleanup using id from list
    const todos = ydiJson<{ id: string; text: string }[]>("list", "--all")
    const created = todos.find((t) => t.text === "[test] confirm-add")
    expect(created).toBeTruthy()
    if (created) createdTodoIds.push(created.id)
  })
})

describe("agent envelope: done --agent dry-run vs --confirm", () => {
  let todoId: string

  it("seeds a todo to mark done", () => {
    const todo = ydiJson<{ id: string }>("add", "[test] done-agent target")
    todoId = todo.id
    createdTodoIds.push(todoId)
  })

  it("ydi done <id> --agent without --confirm is a dry-run (status remains pending)", () => {
    const result = ydi("done", todoId.slice(0, 8), "--agent")
    expect(result.status).toBe(0)
    expect(result.stdout).toContain("## Status\nDry-run")
    expect(result.stdout).toContain("--confirm")
    const t = ydiJson<{ status: string }[]>("list", "--all")
    const found = t.find((x) => (x as { id?: string }).id === todoId) as { status: string } | undefined
    expect(found?.status).toBe("pending")
  })

  it("ydi done <id> --agent --confirm marks done and renders Success", () => {
    const result = ydi("done", todoId.slice(0, 8), "--agent", "--confirm")
    expect(result.status).toBe(0)
    expect(result.stdout).toContain("## Status\nSuccess")
    const t = ydiJson<{ id: string; status: string }[]>("list", "--all")
    const found = t.find((x) => x.id === todoId)
    expect(found?.status).toBe("done")
  })

  it("ydi done with no id and --agent emits a structured error envelope", () => {
    const result = ydi("done", "--agent")
    expect(result.status).not.toBe(0)
    expect(result.stdout).toContain("## Status\nError")
    expect(result.stdout).toContain("**Code:**")
  })

  it("ydi done with non-existent id and --agent emits NOT_FOUND", () => {
    const result = ydi("done", "ffffffffff", "--agent")
    expect(result.status).toBe(3)
    expect(result.stdout).toContain("## Status\nError")
  })
})

describe("agent envelope: delete --agent dry-run vs --confirm", () => {
  let todoId: string

  it("seeds a todo to delete", () => {
    const todo = ydiJson<{ id: string }>("add", "[test] delete-agent target")
    todoId = todo.id
    createdTodoIds.push(todoId)
  })

  it("ydi delete <id> --agent without --confirm leaves the todo intact", () => {
    const result = ydi("delete", todoId.slice(0, 8), "--agent")
    expect(result.status).toBe(0)
    expect(result.stdout).toContain("## Status\nDry-run")
    expect(result.stdout).toContain("Delete is permanent")
    const t = ydiJson<{ id: string }[]>("list", "--all")
    expect(t.find((x) => x.id === todoId)).toBeTruthy()
  })

  it("ydi delete <id> --agent --confirm removes the todo", () => {
    const result = ydi("delete", todoId.slice(0, 8), "--agent", "--confirm")
    expect(result.status).toBe(0)
    expect(result.stdout).toContain("## Status\nSuccess")
    const t = ydiJson<{ id: string }[]>("list", "--all")
    expect(t.find((x) => x.id === todoId)).toBeUndefined()
    const idx = createdTodoIds.indexOf(todoId)
    if (idx !== -1) createdTodoIds.splice(idx, 1)
  })
})

describe("agent envelope: update --agent dry-run vs --confirm", () => {
  let todoId: string

  it("seeds a todo to update", () => {
    const todo = ydiJson<{ id: string }>("add", "[test] update-agent original")
    todoId = todo.id
    createdTodoIds.push(todoId)
  })

  it("ydi update <id> --text --agent without --confirm leaves the text unchanged", () => {
    const result = ydi("update", todoId.slice(0, 8), "--text", "[test] update-agent NEW", "--agent")
    expect(result.status).toBe(0)
    expect(result.stdout).toContain("## Status\nDry-run")
    const t = ydiJson<{ id: string; text: string }[]>("list", "--all")
    const found = t.find((x) => x.id === todoId)
    expect(found?.text).toBe("[test] update-agent original")
  })

  it("ydi update <id> --text --agent --confirm changes the text", () => {
    const result = ydi("update", todoId.slice(0, 8), "--text", "[test] update-agent NEW", "--agent", "--confirm")
    expect(result.status).toBe(0)
    expect(result.stdout).toContain("## Status\nSuccess")
    const t = ydiJson<{ id: string; text: string }[]>("list", "--all")
    const found = t.find((x) => x.id === todoId)
    expect(found?.text).toBe("[test] update-agent NEW")
  })
})

describe("agent envelope: keys create --agent dry-run vs --confirm", () => {
  it("ydi keys create --agent without --confirm does NOT create a key", () => {
    const before = ydiJson<{ id: string; name: string }[]>("keys", "list")
    const result = ydi("keys", "create", "--name", "[test] dry-run key", "--agent")
    expect(result.status).toBe(0)
    expect(result.stdout).toContain("## Status\nDry-run")
    expect(result.stdout).toContain("shown only once")
    const after = ydiJson<{ id: string; name: string }[]>("keys", "list")
    expect(after.length).toBe(before.length)
    expect(after.find((k) => k.name === "[test] dry-run key")).toBeUndefined()
  })

  it("ydi keys create --agent --confirm creates the key and exposes it once", () => {
    const result = ydi("keys", "create", "--name", "[test] confirm key", "--agent", "--confirm")
    expect(result.status).toBe(0)
    expect(result.stdout).toContain("## Status\nSuccess")
    expect(result.stdout).toMatch(/Key \(shown once\):.*ydi_live_/)
    const keys = ydiJson<{ id: string; name: string }[]>("keys", "list")
    const created = keys.find((k) => k.name === "[test] confirm key")
    expect(created).toBeTruthy()
    if (created) createdKeyIds.push(created.id)
  })
})

describe("agent envelope: config set --agent dry-run vs --confirm", () => {
  function getTimezone(): string {
    const out = ydi("config", "get", "timezone").stdout
    const m = out.match(/timezone = (\S+)/)
    if (!m) throw new Error(`Could not parse 'config get timezone' output: ${out}`)
    return m[1]
  }

  let originalTimezone: string

  it("captures original timezone", () => {
    originalTimezone = getTimezone()
    expect(originalTimezone).toBeTruthy()
  })

  it("ydi config set --agent without --confirm does NOT persist the change", () => {
    const result = ydi("config", "set", "timezone", "America/New_York", "--agent")
    expect(result.status).toBe(0)
    expect(result.stdout).toContain("## Status\nDry-run")
    expect(getTimezone()).toBe(originalTimezone)
  })

  it("ydi config set --agent --confirm persists the change", () => {
    const result = ydi("config", "set", "timezone", "America/New_York", "--agent", "--confirm")
    expect(result.status).toBe(0)
    expect(result.stdout).toContain("## Status\nSuccess")
    expect(getTimezone()).toBe("America/New_York")
  })

  it("restores the original timezone", () => {
    const result = ydi("config", "set", "timezone", originalTimezone, "--agent", "--confirm")
    expect(result.status).toBe(0)
    expect(getTimezone()).toBe(originalTimezone)
  })

  it("ydi config set with unknown key --agent emits an error envelope", () => {
    const result = ydi("config", "set", "not-a-real-setting", "x", "--agent")
    expect(result.status).not.toBe(0)
    expect(result.stdout).toContain("## Status\nError")
  })
})

describe("agent envelope: sweep --agent", () => {
  it("ydi sweep --agent emits a dry-run-or-success envelope (no interactive prompt)", () => {
    const result = ydi("sweep", "--agent")
    expect(result.status).toBe(0)
    expectEnvelope(result.stdout, "ydi sweep")
    // Must be either Dry-run (stale items found) or Success (no stale items)
    expect(result.stdout).toMatch(/## Status\n(Dry-run|Success)/)
  })
})

// ---------------------------------------------------------------------------
// Agent describe — schema introspection
// ---------------------------------------------------------------------------

describe("agent describe", () => {
  it("ydi --agent describe lists every command", () => {
    const result = ydi("--agent", "describe")
    expect(result.status).toBe(0)
    expect(result.stdout).toContain("# ydi --agent describe")
    expect(result.stdout).toContain("## Status\nSuccess (exit 0)")
    expect(result.stdout).toContain("| command | description |")
    expect(result.stdout).toContain("ydi list")
    expect(result.stdout).toContain("ydi add")
    expect(result.stdout).toContain("ydi standup")
    expect(result.stdout).toContain("agent-output/v1")
  })

  it("ydi list --agent describe shows flags and examples", () => {
    const result = ydi("list", "--agent", "describe")
    expect(result.status).toBe(0)
    expect(result.stdout).toContain("# ydi list --agent describe")
    expect(result.stdout).toContain("### Flags")
    expect(result.stdout).toContain("--agent")
    expect(result.stdout).toContain("--compact")
    expect(result.stdout).toContain("--cursor")
    expect(result.stdout).toContain("### Examples")
    expect(result.stdout).toContain("ydi list --agent --compact --limit 25")
    expect(result.stdout).toContain("### Related")
  })

  it("ydi add --agent describe shows args + flags + examples", () => {
    const result = ydi("add", "--agent", "describe")
    expect(result.status).toBe(0)
    expect(result.stdout).toContain("# ydi add --agent describe")
    expect(result.stdout).toContain("### Args")
    expect(result.stdout).toContain("| text |")
    expect(result.stdout).toContain("--confirm")
    expect(result.stdout).toContain("### Examples")
  })

  it("ydi keys list --agent describe (multi-segment topic) works", () => {
    const result = ydi("keys", "list", "--agent", "describe")
    expect(result.status).toBe(0)
    expect(result.stdout).toContain("# ydi keys list --agent describe")
    expect(result.stdout).toContain("### Flags")
  })
})

// ---------------------------------------------------------------------------
// Compact mode (--agent --compact)
// ---------------------------------------------------------------------------

describe("agent envelope: --compact", () => {
  it("ydi list --agent --compact strips Errors/Warnings/Actions and inlines Meta", () => {
    const result = ydi("list", "--agent", "--compact")
    expect(result.status).toBe(0)
    expect(result.stdout).toContain("# ydi list")
    expect(result.stdout).toContain("## Status")
    expect(result.stdout).toContain("## Result")
    // Compact strips these
    expect(result.stdout).not.toContain("## Errors")
    expect(result.stdout).not.toContain("## Actions")
    expect(result.stdout).not.toContain("## Warnings")
    expect(result.stdout).not.toContain("## Meta")
    // Inline meta still includes the version
    expect(result.stdout).toMatch(/^Meta: agent-output\/v1/m)
  })

  it("ydi list --agent --compact is smaller than --agent", () => {
    // Seed a few todos so the table is non-trivial
    for (let i = 0; i < 3; i++) {
      const t = ydiJson<{ id: string }>("add", `[test] compact row ${i}`)
      createdTodoIds.push(t.id)
    }
    const full = ydi("list", "--agent", "--limit", "25")
    const compact = ydi("list", "--agent", "--compact", "--limit", "25")
    expect(full.status).toBe(0)
    expect(compact.status).toBe(0)
    // For small list responses, the table dominates; envelope savings are
    // modest but real. Assert the boilerplate sections are gone (the
    // unit test verifies the ~30% target with synthetic inputs).
    expect(compact.stdout.length).toBeLessThan(full.stdout.length)
    expect(compact.stdout).not.toContain("## Errors")
    expect(compact.stdout).not.toContain("## Actions")
    expect(compact.stdout).not.toContain("## Meta")
  })

  it("ydi standup --agent --compact emits the slim envelope", () => {
    const result = ydi("standup", "--agent", "--compact")
    expect(result.status).toBe(0)
    expect(result.stdout).toContain("# ydi standup")
    expect(result.stdout).not.toContain("## Actions")
    expect(result.stdout).toMatch(/^Meta: agent-output\/v1/m)
  })
})

// ---------------------------------------------------------------------------
// Cursor pagination
// ---------------------------------------------------------------------------

describe("agent envelope: cursor pagination", () => {
  it("ydi list --agent surfaces next_cursor in Meta when more results are available", () => {
    // Seed enough todos to force pagination at limit=2
    const ids: string[] = []
    for (let i = 0; i < 3; i++) {
      const t = ydiJson<{ id: string }>("add", `[test] page row ${i}`)
      ids.push(t.id)
      createdTodoIds.push(t.id)
    }
    const result = ydi("list", "--agent", "--all", "--limit", "2")
    expect(result.status).toBe(0)
    expect(result.stdout).toMatch(/next_cursor: \d+/)
    expect(result.stdout).toContain("Next page: `ydi list --agent --limit 2 --cursor")
  })

  it("ydi list --agent --cursor pulls the next page", () => {
    // Capture the cursor from the first page, then request the next one.
    const first = ydi("list", "--agent", "--all", "--limit", "2")
    expect(first.status).toBe(0)
    const m = first.stdout.match(/next_cursor: (\d+)/)
    if (!m) return // not enough todos to paginate — skip
    const cursor = m[1]
    const next = ydi("list", "--agent", "--all", "--limit", "2", "--cursor", cursor)
    expect(next.status).toBe(0)
    expect(next.stdout).toContain(`cursor: ${cursor}`)
  })
})
