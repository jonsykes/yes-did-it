import { readFileSync, writeFileSync, mkdirSync } from "fs"
import { homedir } from "os"
import { join } from "path"

// ---------------------------------------------------------------------------
// Config (same format + path as CLI — used for stdio mode)
// ---------------------------------------------------------------------------

const CONFIG_DIR = join(homedir(), ".config", "yesdidit")
const CONFIG_FILE = join(CONFIG_DIR, "config.json")

type Config = {
  access_token: string
  refresh_token: string
  expires_at: number
  user: {
    id: string
    email: string
    name: string | null
    avatar_url: string | null
  }
}

function readConfig(): Config | null {
  try {
    const raw = readFileSync(CONFIG_FILE, "utf8")
    const parsed = JSON.parse(raw)
    if (!parsed.access_token) return null
    return parsed as Config
  } catch {
    return null
  }
}

function writeConfig(config: Config): void {
  mkdirSync(CONFIG_DIR, { recursive: true })
  writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2), { mode: 0o600 })
}

function jwtExpiry(token: string): number {
  try {
    const payload = JSON.parse(
      Buffer.from(token.split(".")[1], "base64url").toString()
    )
    return payload.exp as number
  } catch {
    return 0
  }
}

// ---------------------------------------------------------------------------
// Transport auth header (set by HTTP transport — full Authorization value,
// preserving the original scheme: "Bearer <jwt>" or "ApiKey <ydi_live_...>")
// ---------------------------------------------------------------------------

let _transportAuthHeader: string | null = null

/** Set the full Authorization header value provided by the HTTP transport. */
export function setTransportAuthHeader(header: string): void {
  _transportAuthHeader = header
}

/** Clear the transport auth header (e.g. on disconnect). */
export function clearTransportAuthHeader(): void {
  _transportAuthHeader = null
}

// ---------------------------------------------------------------------------
// API helpers
// ---------------------------------------------------------------------------

const API_URL =
  (process.env.YDI_API_URL ?? "https://api.yesdidit.com").replace(/\/$/, "") +
  "/api"

function requireConfig(): Config {
  const config = readConfig()
  if (!config) {
    throw new Error("Not logged in. Run `ydi login` first.")
  }
  return config
}

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

/**
 * Get the Authorization header value. In HTTP mode, returns the full header
 * set by the transport (preserves "Bearer <jwt>" or "ApiKey <key>" scheme).
 * In stdio mode, reads from local config with auto-refresh and wraps in Bearer.
 */
async function getAuthHeader(): Promise<string> {
  if (_transportAuthHeader) {
    return _transportAuthHeader
  }
  const config = requireConfig()
  const token = await refreshIfNeeded(config)
  return `Bearer ${token}`
}

async function apiFetch(
  path: string,
  opts: RequestInit = {}
): Promise<Response> {
  const authHeader = await getAuthHeader()
  return fetch(`${API_URL}${path}`, {
    ...opts,
    headers: {
      "Content-Type": "application/json",
      Authorization: authHeader,
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

// ---------------------------------------------------------------------------
// Todo type
// ---------------------------------------------------------------------------

export type GitContext = {
  branch?: string
  commit?: string
  repo?: string
  repo_owner?: string
  repo_name?: string
  issue?: number
  pr?: number
  worktree?: boolean
}

export type Todo = {
  id: string
  text: string
  status: "pending" | "done"
  due_at: string | null
  completed_at: string | null
  created_at: string
  updated_at: string
  tags: string[]
  context: GitContext | null
}

// ---------------------------------------------------------------------------
// ID resolution (short prefix → full UUID, same as CLI)
// ---------------------------------------------------------------------------

async function resolveId(id: string): Promise<string> {
  if (id.length === 36) return id
  const todos = await listTodos({ status: "all", limit: 200 })
  const matches = todos.filter((t) => t.id.startsWith(id))
  if (matches.length === 0) throw new Error(`No todo found matching "${id}"`)
  if (matches.length > 1)
    throw new Error(
      `Ambiguous ID "${id}" — ${matches.length} todos match. Use more characters.`
    )
  return matches[0].id
}

// ---------------------------------------------------------------------------
// Public API functions
// ---------------------------------------------------------------------------

export async function listTodos(params: {
  status?: "pending" | "done" | "all"
  filter?: string
  tags?: string
  limit?: number
  branch?: string
  repo?: string
  issue?: number
  pr?: number
  file?: string
  tag?: string
  has_context?: boolean
  completed_since?: string
}): Promise<Todo[]> {
  const qs = new URLSearchParams()
  if (params.status) qs.set("status", params.status)
  if (params.filter) qs.set("filter", params.filter)
  if (params.tags) qs.set("tags", params.tags)
  if (params.limit) qs.set("limit", String(params.limit))
  if (params.branch) qs.set("branch", params.branch)
  if (params.repo) qs.set("repo", params.repo)
  if (params.issue) qs.set("issue", String(params.issue))
  if (params.pr) qs.set("pr", String(params.pr))
  if (params.file) qs.set("file", params.file)
  if (params.tag) qs.set("tag", params.tag)
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
  context?: GitContext | null
}): Promise<Todo> {
  const res = await apiFetch("/todos", {
    method: "POST",
    body: JSON.stringify(body),
  })
  return json<Todo>(res)
}

export async function completeTodo(id: string): Promise<Todo> {
  const fullId = await resolveId(id)
  const res = await apiFetch(`/todos/${fullId}/done`, { method: "POST" })
  return json<Todo>(res)
}

export async function deleteTodo(id: string): Promise<void> {
  const fullId = await resolveId(id)
  const res = await apiFetch(`/todos/${fullId}`, { method: "DELETE" })
  await json(res)
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
