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
