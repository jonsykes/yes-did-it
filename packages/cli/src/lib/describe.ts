/**
 * `--agent describe` — runtime schema introspection.
 *
 * Two shapes:
 *  - `ydi --agent describe`           → top-level command index
 *  - `ydi <cmd> --agent describe`     → per-command schema (flags, args,
 *                                       examples, related commands)
 *
 * Driven from oclif's loaded Config so we read whatever the command class
 * actually declared (no duplication, no drift). Commands can opt into richer
 * output by declaring `static agentMeta = { examples, related }`.
 */
import type { Config, Command } from "@oclif/core"
import { formatAgentResponse, formatMarkdownTable } from "../shared"
import { TOOL_META } from "./agent"

interface AgentMeta {
  examples?: string[]
  related?: string[]
}

const DESCRIBE_TOKEN = "describe"

/**
 * Detect `--agent describe` in raw argv. If so, return the target command id
 * (or `null` for the top-level index) and the stripped argv.
 *
 * Accepts the literal forms documented in the framework:
 *   ydi --agent describe
 *   ydi list --agent describe
 *   ydi keys list --agent describe
 *   ydi list describe --agent      (also accepted; order-insensitive)
 */
export function detectDescribe(
  argv: string[],
  commandIds: string[],
): { commandId: string | null; describe: boolean } {
  const hasAgent = argv.includes("--agent")
  const hasDescribe = argv.includes(DESCRIBE_TOKEN)
  if (!hasAgent || !hasDescribe) return { commandId: null, describe: false }

  // Non-flag positional tokens before `describe`. The first non-flag tokens
  // form the candidate command id (oclif supports space-separated topics).
  const positional: string[] = []
  for (const tok of argv) {
    if (tok === DESCRIBE_TOKEN) break
    if (tok.startsWith("-")) continue
    positional.push(tok)
  }

  // Find the longest command-id prefix that matches a known command.
  // commandIds use colon separators ("keys:list"), argv uses spaces.
  for (let len = positional.length; len > 0; len--) {
    const candidate = positional.slice(0, len).join(":")
    if (commandIds.includes(candidate)) {
      return { commandId: candidate, describe: true }
    }
  }

  return { commandId: null, describe: true }
}

export async function runDescribe(
  config: Config,
  commandId: string | null,
): Promise<string> {
  if (commandId === null) return renderTopLevel(config)
  return renderCommand(config, commandId)
}

function renderTopLevel(config: Config): string {
  const rows = config.commandIDs
    .slice()
    .sort()
    .map((id) => {
      const cmd = config.findCommand(id)
      return {
        command: `ydi ${id.replace(/:/g, " ")}`,
        description: (cmd as { description?: string }).description ?? "",
      }
    })

  const result = formatMarkdownTable(rows, ["command", "description"])
  return formatAgentResponse({
    command: "ydi --agent describe",
    status: "success",
    exitCode: 0,
    statusSummary: `${rows.length} command${rows.length === 1 ? "" : "s"}`,
    result,
    actions: [
      "Schema for one command: `ydi <cmd> --agent describe`",
      "Read the CLI guide: `cat $(pnpm exec ydi --help | head -1)/AGENT.md` (or open packages/cli/AGENT.md in this repo)",
    ],
    meta: { tool: TOOL_META },
  })
}

async function renderCommand(config: Config, commandId: string): Promise<string> {
  const loadable = config.findCommand(commandId, { must: true })
  const Cls = (await loadable.load()) as typeof Command & {
    flags?: Record<string, FlagDef>
    args?: Record<string, ArgDef>
    description?: string
    agentMeta?: AgentMeta
  }
  const flags = Cls.flags ?? {}
  const args = Cls.args ?? {}
  const meta: AgentMeta = Cls.agentMeta ?? {}
  const displayName = `ydi ${commandId.replace(/:/g, " ")}`

  const sections: string[] = []
  if (Cls.description) {
    sections.push(`**Description:** ${Cls.description}`)
    sections.push("")
  }

  const argRows = Object.entries(args).map(([name, a]) => ({
    name,
    required: a.required ? "yes" : "no",
    description: a.description ?? "",
  }))
  if (argRows.length > 0) {
    sections.push("### Args")
    sections.push(formatMarkdownTable(argRows, ["name", "required", "description"]))
    sections.push("")
  }

  const flagRows = Object.entries(flags).map(([name, f]) => ({
    flag: `--${name}` + (f.char ? `, -${f.char}` : ""),
    type: flagType(f),
    default: flagDefault(f),
    required: f.required ? "yes" : "no",
    description: f.description ?? "",
  }))
  sections.push("### Flags")
  sections.push(
    formatMarkdownTable(flagRows, [
      "flag",
      "type",
      "default",
      "required",
      "description",
    ]),
  )

  if (meta.examples && meta.examples.length > 0) {
    sections.push("")
    sections.push("### Examples")
    sections.push(meta.examples.map((e) => `- \`${e}\``).join("\n"))
  }

  if (meta.related && meta.related.length > 0) {
    sections.push("")
    sections.push("### Related")
    sections.push(meta.related.map((r) => `- \`${r}\``).join("\n"))
  }

  return formatAgentResponse({
    command: `${displayName} --agent describe`,
    status: "success",
    exitCode: 0,
    statusSummary: `${flagRows.length} flag${flagRows.length === 1 ? "" : "s"}`,
    result: sections.join("\n"),
    meta: { tool: TOOL_META },
  })
}

interface FlagDef {
  type?: string
  char?: string
  description?: string
  required?: boolean
  default?: unknown
  multiple?: boolean
  options?: readonly string[]
}

interface ArgDef {
  required?: boolean
  description?: string
}

function flagType(f: FlagDef): string {
  if (f.options && f.options.length > 0) {
    const opts = [...f.options].join(" | ")
    return f.multiple ? `enum[${opts}]+` : `enum[${opts}]`
  }
  const base = f.type ?? "string"
  return f.multiple ? `${base}+` : base
}

function flagDefault(f: FlagDef): string {
  if (f.default === undefined) return "—"
  if (typeof f.default === "function") return "—"
  return String(f.default)
}
