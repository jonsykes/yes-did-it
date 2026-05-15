import type { AgentError, AgentStatus, ApiError, ExitCode } from "./types"
import { EXIT_CODES } from "./types"

export const AGENT_OUTPUT_VERSION = "agent-output/v1"

export interface FormatAgentResponseParams {
  command: string
  status: AgentStatus
  exitCode: number
  statusSummary: string
  result: string
  errors?: string
  warnings?: string[]
  actions?: string[]
  meta?: Record<string, string>
  compact?: boolean
}

export function formatAgentResponse(params: FormatAgentResponseParams): string {
  const sections: string[] = []
  const hasErrors = params.errors !== undefined && params.errors.length > 0
  const compact = params.compact === true && !hasErrors

  sections.push(`# ${params.command}`)

  const statusLabel = capitalize(params.status)
  const summary = params.statusSummary
    ? ` | ${params.statusSummary}`
    : ""
  sections.push(`## Status\n${statusLabel} (exit ${params.exitCode})${summary}`)

  sections.push(`## Result\n${params.result.length > 0 ? params.result : "None"}`)

  if (!compact) {
    sections.push(`## Errors\n${hasErrors ? params.errors : "None"}`)
  }

  if (!compact && params.warnings && params.warnings.length > 0) {
    sections.push(
      `## Warnings\n${params.warnings.map((w) => `- ${w}`).join("\n")}`,
    )
  }

  if (!compact && params.actions && params.actions.length > 0) {
    sections.push(
      `## Actions\n${params.actions.map((a) => `- ${a}`).join("\n")}`,
    )
  }

  const metaParts: string[] = [AGENT_OUTPUT_VERSION]
  if (params.meta) {
    for (const value of Object.values(params.meta)) {
      if (value && value.length > 0) metaParts.push(value)
    }
  }
  if (compact) {
    sections.push(`Meta: ${metaParts.join(" | ")}`)
  } else {
    sections.push(`## Meta\n${metaParts.join(" | ")}`)
  }

  return sections.join("\n\n")
}

export function formatMarkdownTable(
  rows: Array<Record<string, unknown>>,
  fields?: string[],
): string {
  if (rows.length === 0) return "No results."

  const cols = fields && fields.length > 0
    ? fields
    : Array.from(
        rows.reduce<Set<string>>((set, row) => {
          for (const k of Object.keys(row)) set.add(k)
          return set
        }, new Set()),
      )

  if (cols.length === 0) return "No results."

  const header = `| ${cols.join(" | ")} |`
  const separator = `| ${cols.map(() => "---").join(" | ")} |`
  const body = rows.map(
    (row) =>
      `| ${cols.map((c) => formatCellValue(row[c])).join(" | ")} |`,
  )

  return [header, separator, ...body].join("\n")
}

export function formatKeyValue(
  obj: Record<string, unknown>,
  fields?: string[],
): string {
  const keys = fields && fields.length > 0 ? fields : Object.keys(obj)
  if (keys.length === 0) return "None"
  return keys
    .map((k) => `- **${k}:** ${formatCellValue(obj[k])}`)
    .join("\n")
}

export function formatAgentError(err: AgentError): string {
  const lines = [
    `- **Code:** \`${err.code}\``,
    `- **Message:** ${err.message}`,
    `- **Retryable:** ${err.retryable ? "Yes" : "No"}`,
  ]
  if (err.retryable && err.retryAfter) {
    lines.push(`- **Retry-After:** ${err.retryAfter}`)
  }
  if (err.detail) lines.push(`- **Detail:** ${err.detail}`)
  if (err.suggestion) lines.push(`- **Suggestion:** ${err.suggestion}`)
  return lines.join("\n")
}

const API_ERROR_TO_AGENT: Record<
  string,
  { exitCode: ExitCode; retryable: boolean }
> = {
  NOT_FOUND: { exitCode: EXIT_CODES.NOT_FOUND, retryable: false },
  UNAUTHORIZED: { exitCode: EXIT_CODES.PERMISSION_DENIED, retryable: false },
  FORBIDDEN: { exitCode: EXIT_CODES.PERMISSION_DENIED, retryable: false },
  PERMISSION_DENIED: { exitCode: EXIT_CODES.PERMISSION_DENIED, retryable: false },
  CONFLICT: { exitCode: EXIT_CODES.CONFLICT, retryable: false },
  RATE_LIMITED: { exitCode: EXIT_CODES.RATE_LIMITED, retryable: true },
  TIMEOUT: { exitCode: EXIT_CODES.TIMEOUT, retryable: true },
  VALIDATION_ERROR: { exitCode: EXIT_CODES.VALIDATION_FAILED, retryable: true },
  VALIDATION_FAILED: { exitCode: EXIT_CODES.VALIDATION_FAILED, retryable: true },
  BAD_REQUEST: { exitCode: EXIT_CODES.USAGE_ERROR, retryable: true },
}

export function mapApiErrorToAgent(err: ApiError): {
  agentError: AgentError
  exitCode: ExitCode
} {
  const code = err.error.code
  const mapping = API_ERROR_TO_AGENT[code]
  const exitCode = mapping?.exitCode ?? EXIT_CODES.GENERAL_FAILURE
  const retryable = mapping?.retryable ?? false

  const detail = err.error.details
    ? safeStringify(err.error.details)
    : undefined

  return {
    agentError: {
      code,
      message: err.error.message,
      retryable,
      detail,
    },
    exitCode,
  }
}

function capitalize(s: string): string {
  if (s.length === 0) return s
  return s.charAt(0).toUpperCase() + s.slice(1)
}

function formatCellValue(value: unknown): string {
  if (value === null || value === undefined || value === "") return "—"
  if (typeof value === "string") return escapeTableCell(value)
  if (typeof value === "number" || typeof value === "boolean")
    return String(value)
  if (Array.isArray(value)) {
    if (value.length === 0) return "—"
    return escapeTableCell(value.map((v) => String(v)).join(", "))
  }
  return escapeTableCell(safeStringify(value))
}

function escapeTableCell(s: string): string {
  return s.replace(/\|/g, "\\|").replace(/\n/g, " ")
}

function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}
