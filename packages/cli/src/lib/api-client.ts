import { readConfig, writeConfig, jwtExpiry, type Config } from "./config"

const API_URL = (process.env.YDI_API_URL ?? "https://api.yesdidit.com").replace(/\/$/, "") + "/api"

import type { GitContext } from "../shared"

export type Todo = {
  id: string
  text: string
  status: "pending" | "done"
  due_at: string | null
  completed_at: string | null
  created_at: string
  updated_at: string
  context: GitContext | null
  tags: string[]
}

export type ApiKey = {
  id: string
  name: string
  key_prefix: string
  created_at: string
  last_used_at: string | null
  expires_at: string | null
}

/** Require config or throw a user-friendly error. */
function requireConfig(): Config {
  const config = readConfig()
  if (!config) {
    throw new Error("Not logged in. Run `ydi login` first.")
  }
  return config
}

/** Refresh access token if within 5 minutes of expiry. Returns updated token. */
async function refreshIfNeeded(config: Config): Promise<string> {
  const now = Math.floor(Date.now() / 1000)
  if (config.expires_at - now > 300) {
    return config.access_token
  }

  const res = await fetch(`${API_URL}/auth/refresh`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ refresh_token: config.refresh_token }),
  })

  if (!res.ok) {
    throw new Error("Session expired. Run `ydi login` to re-authenticate.")
  }

  const data = (await res.json()) as { access_token: string; refresh_token: string }
  config.access_token = data.access_token
  config.expires_at = jwtExpiry(data.access_token)
  if (data.refresh_token) {
    config.refresh_token = data.refresh_token
  }
  writeConfig(config)
  return config.access_token
}

async function apiFetch(
  path: string,
  opts: RequestInit = {}
): Promise<Response> {
  const config = requireConfig()
  const token = await refreshIfNeeded(config)
  return fetch(`${API_URL}${path}`, {
    ...opts,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
      ...(opts.headers as Record<string, string> | undefined),
    },
  })
}

async function json<T>(res: Response): Promise<T> {
  const text = await res.text()
  let body: T & { error?: { code: string; message: string } }
  try {
    body = JSON.parse(text)
  } catch {
    throw new Error(`HTTP ${res.status}: unexpected response from server`)
  }
  if (!res.ok) {
    const msg = body.error?.message ?? `HTTP ${res.status}`
    throw new Error(msg)
  }
  return body
}

/**
 * Accepts a full UUID or a short prefix (e.g. "07f268c9").
 * If a prefix, fetches all todos and finds the unique match.
 */
async function resolveId(id: string): Promise<string> {
  if (id.length === 36) return id
  const todos = await listTodos({ status: "all", limit: 200 })
  const matches = todos.filter((t) => t.id.startsWith(id))
  if (matches.length === 0) throw new Error(`No todo found matching "${id}"`)
  if (matches.length > 1) throw new Error(`Ambiguous ID "${id}" — ${matches.length} todos match. Use more characters.`)
  return matches[0].id
}

// ---------------------------------------------------------------------------
// Todos
// ---------------------------------------------------------------------------

export async function listTodos(params: {
  filter?: string
  status?: "pending" | "done" | "all"
  tags?: string
  limit?: number
  branch?: string
  repo?: string
  issue?: number
  pr?: number
  file?: string
  git_tag?: string
  has_context?: boolean
  completed_since?: string
}): Promise<Todo[]> {
  const qs = new URLSearchParams()
  if (params.filter) qs.set("filter", params.filter)
  if (params.status) qs.set("status", params.status)
  if (params.tags) qs.set("tags", params.tags)
  if (params.limit) qs.set("limit", String(params.limit))
  if (params.branch) qs.set("branch", params.branch)
  if (params.repo) qs.set("repo", params.repo)
  if (params.issue) qs.set("issue", String(params.issue))
  if (params.pr) qs.set("pr", String(params.pr))
  if (params.file) qs.set("file", params.file)
  if (params.git_tag) qs.set("tag", params.git_tag)
  if (params.has_context !== undefined) qs.set("has_context", String(params.has_context))
  if (params.completed_since) qs.set("completed_since", params.completed_since)

  const res = await apiFetch(`/todos?${qs}`)
  const data = await json<{ todos: Todo[] }>(res)
  return data.todos
}

export async function createTodo(body: {
  text: string
  due_at?: string | null
  tags?: string[]
  context?: GitContext
}): Promise<Todo> {
  const res = await apiFetch("/todos", {
    method: "POST",
    body: JSON.stringify(body),
  })
  return json<Todo>(res)
}

export async function markDone(id: string): Promise<Todo> {
  const fullId = await resolveId(id)
  const res = await apiFetch(`/todos/${fullId}/done`, { method: "POST" })
  return json<Todo>(res)
}

export async function reopenTodo(id: string): Promise<Todo> {
  const fullId = await resolveId(id)
  const res = await apiFetch(`/todos/${fullId}/reopen`, { method: "POST" })
  return json<Todo>(res)
}

export async function updateTodo(
  id: string,
  body: { text?: string; due_at?: string | null; tags?: string[] }
): Promise<Todo> {
  const fullId = await resolveId(id)
  const res = await apiFetch(`/todos/${fullId}`, {
    method: "PATCH",
    body: JSON.stringify(body),
  })
  return json<Todo>(res)
}

export async function bulkDone(ids: string[]): Promise<{ updated: number }> {
  const res = await apiFetch("/todos/bulk", {
    method: "POST",
    body: JSON.stringify({ operation: "done", ids }),
  })
  return json<{ updated: number }>(res)
}

export async function deleteTodo(id: string): Promise<void> {
  const fullId = await resolveId(id)
  const res = await apiFetch(`/todos/${fullId}`, { method: "DELETE" })
  await json(res)
}

// ---------------------------------------------------------------------------
// API Keys
// ---------------------------------------------------------------------------

export async function listApiKeys(): Promise<ApiKey[]> {
  const res = await apiFetch("/auth/keys")
  const data = await json<{ keys: ApiKey[] }>(res)
  return data.keys
}

export async function createApiKey(body: {
  name: string
  expires_at?: string
}): Promise<ApiKey & { key: string }> {
  const res = await apiFetch("/auth/keys", {
    method: "POST",
    body: JSON.stringify(body),
  })
  return json<ApiKey & { key: string }>(res)
}

export async function deleteApiKey(id: string): Promise<void> {
  const res = await apiFetch(`/auth/keys/${id}`, { method: "DELETE" })
  await json(res)
}
