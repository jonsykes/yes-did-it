/**
 * get_agenda MCP tool handler.
 *
 * Three-channel response per the MCP Apps spec (2026-01-26):
 *   - content   → terse text for the model to narrate from
 *   - content   → markdown fallback tagged audience:["user"] for non-UI hosts
 *   - structuredContent → aggregates for model follow-ups
 *   - _meta["ydi.todos"] → full row data for the widget only
 *
 * The widget resource is referenced via `_meta.ui.resourceUri` on the tool
 * registration (in server.ts) — the host fetches it separately. Embedding the
 * resource as a content block here causes the host to stringify it inline.
 *
 * Three parallel `listTodos({ filter })` calls mirror the standup tool's pattern
 * — no new API endpoints needed.
 */

import { listTodos, type Todo } from "./api-client.js"

export const AGENDA_UI_URI = "ui://ydi/agenda"

export type AgendaBucket = "overdue" | "today" | "week"

export type AgendaRow = {
  id: string
  text: string
  due_at: string | null
  bucket: AgendaBucket
  tags: string[]
  branch: string | null
  repo_slug: string | null
}

export type AgendaWindow = "today" | "this-week" | "overdue+today"

export type AgendaInput = {
  window?: AgendaWindow
  tag?: string
  branch?: string
}

// Map window → which buckets we fetch. Order matters for dedup priority
// (earlier bucket wins when the same todo id appears in multiple filters).
const BUCKETS_FOR_WINDOW: Record<AgendaWindow, AgendaBucket[]> = {
  "today": ["today"],
  "this-week": ["overdue", "today", "week"],
  "overdue+today": ["overdue", "today"],
}

const FILTER_FOR_BUCKET: Record<AgendaBucket, string> = {
  overdue: "overdue",
  today: "today",
  week: "this-week",
}

/**
 * Fetch todos for the selected buckets in parallel and stitch them into
 * a single deduped list tagged by bucket.
 *
 * Extracted so tests can stub `listTodos` and assert shape end-to-end.
 */
export async function getAgendaRows(
  input: AgendaInput,
  fetchTodos: typeof listTodos = listTodos
): Promise<AgendaRow[]> {
  const window = input.window ?? "overdue+today"
  const buckets = BUCKETS_FOR_WINDOW[window] ?? BUCKETS_FOR_WINDOW["overdue+today"]

  const results = await Promise.all(
    buckets.map((b) =>
      fetchTodos({
        filter: FILTER_FOR_BUCKET[b],
        status: "pending",
        limit: 200,
        tag: input.tag,
        branch: input.branch,
      })
    )
  )

  const byId = new Map<string, AgendaRow>()
  buckets.forEach((bucket, i) => {
    for (const t of results[i]) {
      if (byId.has(t.id)) continue
      byId.set(t.id, toRow(t, bucket))
    }
  })
  return Array.from(byId.values())
}

function toRow(t: Todo, bucket: AgendaBucket): AgendaRow {
  return {
    id: t.id,
    text: t.text,
    due_at: t.due_at,
    bucket,
    tags: t.tags,
    branch: t.context?.branch ?? null,
    repo_slug: t.context?.repo ?? null,
  }
}

/** Renders a bullet list grouped by bucket. Used as the non-UI fallback. */
export function renderMarkdownAgenda(rows: AgendaRow[]): string {
  const overdue = rows.filter((r) => r.bucket === "overdue")
  const today = rows.filter((r) => r.bucket === "today")
  const week = rows.filter((r) => r.bucket === "week")

  const section = (title: string, items: AgendaRow[]): string => {
    if (items.length === 0) return ""
    const lines = items.map((t) => {
      const short = t.id.slice(0, 6)
      const due = t.due_at ? ` — due ${t.due_at}` : ""
      return `- [ ] ${t.text} _(${short})_${due}`
    })
    return `### ${title}\n${lines.join("\n")}`
  }

  const sections = [
    section("🔴 Overdue", overdue),
    section("📅 Today", today),
    section("🗓 This week", week),
  ].filter(Boolean)

  return sections.length ? sections.join("\n\n") : "No active todos in this window."
}

function summaryLine(rows: AgendaRow[]): string {
  const counts = bucketCounts(rows)
  return (
    `${rows.length} active todo${rows.length === 1 ? "" : "s"}: ` +
    `${counts.overdue} overdue, ${counts.today} due today, ${counts.this_week} this week.`
  )
}

function bucketCounts(rows: AgendaRow[]): {
  overdue: number
  today: number
  this_week: number
} {
  return {
    overdue: rows.filter((r) => r.bucket === "overdue").length,
    today: rows.filter((r) => r.bucket === "today").length,
    this_week: rows.filter((r) => r.bucket === "week").length,
  }
}

/**
 * Build the tool result. Separated from `handleGetAgenda` so unit tests can
 * assert the full shape without stubbing the network layer.
 */
export function buildAgendaResult(rows: AgendaRow[]) {
  const counts = bucketCounts(rows)
  const summary = summaryLine(rows)
  const markdown = renderMarkdownAgenda(rows)

  return {
    content: [
      { type: "text" as const, text: summary },
      {
        type: "text" as const,
        text: markdown,
        annotations: { audience: ["user" as const], priority: 0.3 },
      },
    ],
    structuredContent: {
      summary: `${rows.length} active todos`,
      counts,
    },
    _meta: {
      "ydi.todos": rows,
      "ydi.server_time": new Date().toISOString(),
    },
  }
}

export async function handleGetAgenda(input: AgendaInput) {
  const rows = await getAgendaRows(input)
  return buildAgendaResult(rows)
}
