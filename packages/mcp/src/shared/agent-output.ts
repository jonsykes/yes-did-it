export type AgentStatus = "success" | "error" | "partial" | "dry-run"

export interface AgentError {
  code: string
  message: string
  retryable: boolean
  retryAfter?: string
  detail?: string
  suggestion?: string
}

export const EXIT_CODES = {
  SUCCESS: 0,
  GENERAL_FAILURE: 1,
  USAGE_ERROR: 2,
  NOT_FOUND: 3,
  PERMISSION_DENIED: 4,
  CONFLICT: 5,
  RATE_LIMITED: 6,
  TIMEOUT: 7,
  VALIDATION_FAILED: 8,
  PARTIAL_SUCCESS: 10,
} as const

export type ExitCode = (typeof EXIT_CODES)[keyof typeof EXIT_CODES]

export const AGENT_OUTPUT_VERSION = "agent-output/v1"
export const TOOL_META = "tool: @yesdidit/mcp"

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
  const summary = params.statusSummary ? ` | ${params.statusSummary}` : ""
  sections.push(`## Status\n${statusLabel} (exit ${params.exitCode})${summary}`)

  sections.push(`## Result\n${params.result.length > 0 ? params.result : "None"}`)

  if (!compact) {
    sections.push(`## Errors\n${hasErrors ? params.errors : "None"}`)
  }

  if (!compact && params.warnings && params.warnings.length > 0) {
    sections.push(`## Warnings\n${params.warnings.map((w) => `- ${w}`).join("\n")}`)
  }

  if (!compact && params.actions && params.actions.length > 0) {
    sections.push(`## Actions\n${params.actions.map((a) => `- ${a}`).join("\n")}`)
  }

  const metaParts: string[] = [AGENT_OUTPUT_VERSION, TOOL_META]
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

  const cols =
    fields && fields.length > 0
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
    (row) => `| ${cols.map((c) => formatCellValue(row[c])).join(" | ")} |`,
  )

  return [header, separator, ...body].join("\n")
}

export function formatKeyValue(
  obj: Record<string, unknown>,
  fields?: string[],
): string {
  const keys = fields && fields.length > 0 ? fields : Object.keys(obj)
  if (keys.length === 0) return "None"
  return keys.map((k) => `- **${k}:** ${formatCellValue(obj[k])}`).join("\n")
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

/**
 * Map a thrown Error from the MCP api-client to a semantic agent error.
 * Inspects the message string since api-client throws plain Error instances.
 */
export function classifyError(err: unknown): {
  agentError: AgentError
  exitCode: ExitCode
} {
  const message = err instanceof Error ? err.message : String(err)

  if (message.startsWith("No todo found matching")) {
    return {
      agentError: {
        code: "NOT_FOUND",
        message,
        retryable: false,
        suggestion: "Verify the id with list_todos or list_branch_todos.",
      },
      exitCode: EXIT_CODES.NOT_FOUND,
    }
  }
  if (message.startsWith("Ambiguous ID")) {
    return {
      agentError: {
        code: "VALIDATION_FAILED",
        message,
        retryable: true,
        suggestion: "Use more characters of the id prefix, or the full UUID.",
      },
      exitCode: EXIT_CODES.VALIDATION_FAILED,
    }
  }
  if (
    message.startsWith("Not logged in") ||
    message.startsWith("Session expired") ||
    message.includes("UNAUTHORIZED")
  ) {
    return {
      agentError: {
        code: "UNAUTHORIZED",
        message,
        retryable: false,
        suggestion: "Run `ydi login` to re-authenticate.",
      },
      exitCode: EXIT_CODES.PERMISSION_DENIED,
    }
  }
  if (message.toLowerCase().includes("rate limit")) {
    return {
      agentError: { code: "RATE_LIMITED", message, retryable: true },
      exitCode: EXIT_CODES.RATE_LIMITED,
    }
  }
  return {
    agentError: { code: "GENERAL_FAILURE", message, retryable: false },
    exitCode: EXIT_CODES.GENERAL_FAILURE,
  }
}

export interface RenderAgentDryRunParams {
  command: string
  statusSummary: string
  result: string
  confirmHint: string
  warnings?: string[]
  meta?: Record<string, string>
}

export function renderAgentDryRun(params: RenderAgentDryRunParams): string {
  const meta = { ...(params.meta ?? {}), idempotency: "idempotency: not-implemented" }
  return formatAgentResponse({
    command: params.command,
    status: "dry-run",
    exitCode: EXIT_CODES.SUCCESS,
    statusSummary: params.statusSummary,
    result: params.result,
    warnings: params.warnings,
    actions: [`Confirm to execute: ${params.confirmHint}`],
    meta,
  })
}

export interface RenderAgentSuccessParams {
  command: string
  statusSummary: string
  result: string
  actions?: string[]
  warnings?: string[]
  meta?: Record<string, string>
}

export function renderAgentSuccess(params: RenderAgentSuccessParams): string {
  const meta = { ...(params.meta ?? {}), idempotency: "idempotency: not-implemented" }
  return formatAgentResponse({
    command: params.command,
    status: "success",
    exitCode: EXIT_CODES.SUCCESS,
    statusSummary: params.statusSummary,
    result: params.result,
    warnings: params.warnings,
    actions: params.actions,
    meta,
  })
}

export function renderAgentErrorEnvelope(
  command: string,
  err: unknown,
): { output: string; exitCode: ExitCode } {
  const { agentError, exitCode } = classifyError(err)
  const output = formatAgentResponse({
    command,
    status: "error",
    exitCode,
    statusSummary: agentError.message,
    result: "None",
    errors: formatAgentError(agentError),
  })
  return { output, exitCode }
}

function capitalize(s: string): string {
  if (s.length === 0) return s
  return s.charAt(0).toUpperCase() + s.slice(1)
}

function formatCellValue(value: unknown): string {
  if (value === null || value === undefined || value === "") return "—"
  if (typeof value === "string") return escapeTableCell(value)
  if (typeof value === "number" || typeof value === "boolean") return String(value)
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
