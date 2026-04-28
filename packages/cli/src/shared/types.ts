export type TodoStatus = "pending" | "done"

export type TodoFilter =
  | "today"
  | "tomorrow"
  | "this-week"
  | "overdue"
  | "upcoming"
  | "next-hour"
  | "all"

export interface User {
  id: string
  email: string
  name: string | null
  avatar_url: string | null
  created_at: string
  updated_at: string
}

export interface GitContext {
  branch?: string
  commit?: string
  repo?: string
  repo_owner?: string
  repo_name?: string
  issue?: number
  pr?: number
  worktree?: boolean
  files_changed?: string[]
  tag?: string
}

export interface Todo {
  id: string
  user_id: string
  text: string
  status: TodoStatus
  due_at: string | null
  created_at: string
  updated_at: string
  completed_at: string | null
  context: GitContext | null
  tags: string[]
}

export interface ApiKey {
  id: string
  name: string
  prefix: string
  created_at: string
  last_used_at: string | null
  expires_at: string | null
}

export interface ApiError {
  error: {
    code: string
    message: string
    details?: Record<string, unknown>
  }
}

export interface Pagination {
  cursor: string | null
  has_more: boolean
  total_count: number
}
