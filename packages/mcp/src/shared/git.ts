import { execSync } from "child_process"
import type { GitContext } from "./types.js"

function exec(cmd: string, cwd?: string): string | null {
  try {
    return execSync(cmd, {
      cwd,
      encoding: "utf8",
      timeout: 5000,
      stdio: ["pipe", "pipe", "pipe"],
    }).trim()
  } catch {
    return null
  }
}

export function isGitRepo(cwd?: string): boolean {
  return exec("git rev-parse --is-inside-work-tree", cwd) === "true"
}

export function getBranch(cwd?: string): string | null {
  return exec("git rev-parse --abbrev-ref HEAD", cwd)
}

export function getCommit(cwd?: string): string | null {
  return exec("git rev-parse --short HEAD", cwd)
}

export function getRemoteUrl(cwd?: string): string | null {
  return exec("git remote get-url origin", cwd)
}

export function parseRepoSlug(
  remoteUrl: string
): { owner: string; name: string } | null {
  // SSH: git@github.com:owner/repo.git
  const sshMatch = remoteUrl.match(/[:\/]([^/:]+)\/([^/.]+?)(?:\.git)?$/)
  if (sshMatch) {
    return { owner: sshMatch[1], name: sshMatch[2] }
  }
  // HTTPS: https://github.com/owner/repo.git
  const httpsMatch = remoteUrl.match(
    /https?:\/\/[^/]+\/([^/]+)\/([^/.]+?)(?:\.git)?$/
  )
  if (httpsMatch) {
    return { owner: httpsMatch[1], name: httpsMatch[2] }
  }
  return null
}

export function isWorktree(cwd?: string): boolean {
  const gitDir = exec("git rev-parse --git-dir", cwd)
  const commonDir = exec("git rev-parse --git-common-dir", cwd)
  if (!gitDir || !commonDir) return false
  return gitDir !== commonDir
}

export function localBranchExists(name: string, cwd?: string): boolean {
  const result = exec(`git branch --list ${name}`, cwd)
  return result !== null && result.length > 0
}

export function getAllRemoteBranches(cwd?: string): Set<string> {
  try {
    const output = execSync("git ls-remote --heads origin", {
      cwd,
      encoding: "utf8",
      timeout: 10000,
      stdio: ["pipe", "pipe", "pipe"],
    }).trim()
    if (!output) return new Set()
    const branches = new Set<string>()
    for (const line of output.split("\n")) {
      // Format: <sha>\trefs/heads/<branch>
      const ref = line.split("\t")[1]
      if (ref?.startsWith("refs/heads/")) {
        branches.add(ref.slice("refs/heads/".length))
      }
    }
    return branches
  } catch {
    // Timeout or network error — return empty set (treats all as unknown, not stale)
    return new Set()
  }
}

export function getFilesChanged(cwd?: string): string[] | null {
  const output = exec("git diff --name-only HEAD", cwd)
  if (!output) return null
  const files = output.split("\n").filter(Boolean)
  return files.length > 0 ? files.slice(0, 50) : null
}

export function getNearestTag(cwd?: string): string | null {
  return exec("git describe --tags --abbrev=0", cwd)
}

export function getGitContext(cwd?: string): GitContext | null {
  if (!isGitRepo(cwd)) return null

  const branch = getBranch(cwd)
  const commit = getCommit(cwd)
  const remoteUrl = getRemoteUrl(cwd)

  const context: GitContext = {}

  if (branch) context.branch = branch
  if (commit) context.commit = commit

  if (remoteUrl) {
    context.repo = remoteUrl
    const slug = parseRepoSlug(remoteUrl)
    if (slug) {
      context.repo_owner = slug.owner
      context.repo_name = slug.name
    }
  }

  if (isWorktree(cwd)) {
    context.worktree = true
  }

  const filesChanged = getFilesChanged(cwd)
  if (filesChanged) context.files_changed = filesChanged

  const tag = getNearestTag(cwd)
  if (tag) context.tag = tag

  return Object.keys(context).length > 0 ? context : null
}
