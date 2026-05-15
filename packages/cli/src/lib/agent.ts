import { Flags } from "@oclif/core"
import {
  EXIT_CODES,
  formatAgentError,
  formatAgentResponse,
  mapApiErrorToAgent,
  type AgentError,
  type AgentStatus,
  type ApiError,
  type ExitCode,
} from "../shared"
import { ApiClientError } from "./api-client"

const pkg = require("../../package.json") as { version: string }

export const CLI_VERSION = pkg.version
export const TOOL_META = `ydi ${CLI_VERSION}`

export const agentFlag = Flags.boolean({
  description: "Agent-optimized markdown output (envelope with semantic exit codes)",
  default: false,
})

export const fieldsFlag = Flags.string({
  description: "Comma-separated field list to project (use with --agent)",
})

export const confirmFlag = Flags.boolean({
  description: "Required with --agent for mutations; without it, --agent dry-runs",
  default: false,
})

export const compactFlag = Flags.boolean({
  description: "Strip Warnings/Actions/Errors sections and inline Meta (use with --agent)",
  default: false,
})

export const describeFlag = Flags.boolean({
  description: "Print the command's --agent schema (flags, examples) and exit",
  default: false,
})

export function parseFields(value?: string): string[] | undefined {
  if (!value) return undefined
  return value
    .split(",")
    .map((f) => f.trim())
    .filter((f) => f.length > 0)
}

export interface RenderAgentSuccessParams {
  command: string
  status?: AgentStatus
  exitCode?: number
  statusSummary: string
  result: string
  warnings?: string[]
  actions?: string[]
  meta?: Record<string, string>
  startedAt?: number
  compact?: boolean
}

export function renderAgentSuccess(params: RenderAgentSuccessParams): string {
  const meta = { ...(params.meta ?? {}), tool: TOOL_META } as Record<string, string>
  if (params.startedAt) {
    meta.timing = `${Date.now() - params.startedAt}ms`
  }
  return formatAgentResponse({
    command: params.command,
    status: params.status ?? "success",
    exitCode: params.exitCode ?? EXIT_CODES.SUCCESS,
    statusSummary: params.statusSummary,
    result: params.result,
    warnings: params.warnings,
    actions: params.actions,
    meta,
    compact: params.compact,
  })
}

export interface AgentErrorOutput {
  output: string
  exitCode: ExitCode
}

export interface RenderAgentDryRunParams {
  command: string
  statusSummary: string
  result: string
  confirmCommand: string
  warnings?: string[]
  meta?: Record<string, string>
  startedAt?: number
}

export function renderAgentDryRun(params: RenderAgentDryRunParams): string {
  const meta = { ...(params.meta ?? {}), tool: TOOL_META, idempotency: "not-implemented" } as Record<string, string>
  if (params.startedAt) {
    meta.timing = `${Date.now() - params.startedAt}ms`
  }
  return formatAgentResponse({
    command: params.command,
    status: "dry-run",
    exitCode: EXIT_CODES.SUCCESS,
    statusSummary: params.statusSummary,
    result: params.result,
    warnings: params.warnings,
    actions: [`Run with --confirm to execute: \`${params.confirmCommand}\``],
    meta,
  })
}

export function renderAgentError(
  command: string,
  err: unknown,
  startedAt?: number,
): AgentErrorOutput {
  const { agentError, exitCode } = inferAgentError(err)
  const meta: Record<string, string> = { tool: TOOL_META }
  if (startedAt) meta.timing = `${Date.now() - startedAt}ms`
  const summary = humanize(agentError.code)
  const output = formatAgentResponse({
    command,
    status: "error",
    exitCode,
    statusSummary: summary,
    result: "No changes applied.",
    errors: formatAgentError(agentError),
    meta,
  })
  return { output, exitCode }
}

function inferAgentError(err: unknown): {
  agentError: AgentError
  exitCode: ExitCode
} {
  if (err instanceof ApiClientError) {
    const apiErr: ApiError = {
      error: {
        code: err.code,
        message: err.message,
        details: err.details,
      },
    }
    return mapApiErrorToAgent(apiErr)
  }

  const message = err instanceof Error ? err.message : String(err)

  if (/not logged in/i.test(message)) {
    return {
      agentError: {
        code: "UNAUTHORIZED",
        message,
        retryable: false,
        suggestion: "Run `ydi login` to authenticate.",
      },
      exitCode: EXIT_CODES.PERMISSION_DENIED,
    }
  }
  if (/session expired/i.test(message)) {
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
  if (/no todo found/i.test(message)) {
    return {
      agentError: { code: "NOT_FOUND", message, retryable: false },
      exitCode: EXIT_CODES.NOT_FOUND,
    }
  }
  if (/ambiguous id/i.test(message)) {
    return {
      agentError: {
        code: "VALIDATION_FAILED",
        message,
        retryable: true,
        suggestion: "Use more characters of the id.",
      },
      exitCode: EXIT_CODES.VALIDATION_FAILED,
    }
  }
  if (/not in a git repo/i.test(message)) {
    return {
      agentError: {
        code: "VALIDATION_FAILED",
        message,
        retryable: false,
      },
      exitCode: EXIT_CODES.VALIDATION_FAILED,
    }
  }

  return {
    agentError: {
      code: "GENERAL_FAILURE",
      message,
      retryable: false,
    },
    exitCode: EXIT_CODES.GENERAL_FAILURE,
  }
}

function humanize(code: string): string {
  return code.toLowerCase().replace(/_/g, " ")
}
