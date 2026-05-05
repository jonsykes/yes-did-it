/**
 * Local preview harness for the agenda widget.
 *
 * The preview page acts as a minimal MCP Apps host: it loads the widget in an
 * iframe and wires it up via {@link AppBridge `AppBridge`} + `PostMessageTransport`
 * (loaded from esm.sh, same as the widget). This exercises the real
 * `@modelcontextprotocol/ext-apps` postMessage protocol — no shims.
 *
 * Routes:
 *   GET  /                        → preview page (iframe + fixture/live toggle + AppBridge)
 *   GET  /widget                  → widget HTML (unmodified production HTML)
 *   GET  /fixtures/agenda.json    → canned three-channel result
 *   POST /fixtures/call           → echoes the call, logs, no-op
 *   GET  /live/agenda.json        → real listTodos(filter=overdue|today|this-week)
 *   POST /live/call               → dispatches complete_todo / update_todo to real API
 *
 * Run: pnpm --filter @yesdidit/mcp preview
 */

import { createServer, IncomingMessage, ServerResponse } from "http";
import { buildAgendaHtml } from "../src/widgets/agenda.html.js";
import { getWidgetAppAsset } from "../src/widgets/widget-app-asset.js";
import { fixtureResult } from "./fixtures.js";
import {
  listTodos,
  completeTodo,
  updateTodo,
  type Todo,
} from "../src/api-client.js";

const PORT = Number(process.env.PORT ?? 4300);

// ── Preview page (host iframe + AppBridge wiring + fixture/live toggle) ─────

const previewPageHtml = `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<title>YDI Agenda · Preview Harness</title>
<style>
  :root { --line: #e5e5e5; --muted: #6b6b6b; --fg: #111; --bg: #fafafa; }
  * { box-sizing: border-box; }
  html, body { margin: 0; height: 100%; background: var(--bg); color: var(--fg);
    font: 14px/1.4 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; }
  header {
    display: flex; align-items: center; justify-content: space-between;
    padding: 10px 16px; border-bottom: 1px solid var(--line);
    background: #fff;
  }
  .brand { font-weight: 600; }
  .sub { color: var(--muted); font-size: 12px; margin-left: 8px; }
  .modes { display: flex; gap: 0; border: 1px solid var(--line); border-radius: 6px; overflow: hidden; }
  .modes button {
    border: 0; padding: 6px 14px; font: inherit; background: #fff; cursor: pointer;
    color: var(--muted);
  }
  .modes button.active { background: #111; color: #fff; }
  .modes button:disabled { opacity: 0.5; cursor: progress; }
  .wrap { display: flex; justify-content: center; padding: 24px 16px; }
  .frame {
    width: 100%; max-width: 520px;
    background: #fff; border: 1px solid var(--line);
    border-radius: 10px; overflow: hidden;
    box-shadow: 0 1px 2px rgba(0,0,0,0.04), 0 8px 24px rgba(0,0,0,0.04);
  }
  iframe { width: 100%; height: 640px; border: 0; display: block; }
  footer {
    text-align: center; color: var(--muted); font-size: 12px; padding: 8px 16px 24px;
  }
  kbd { font: 11px ui-monospace, Menlo, monospace; background: #f0f0f0;
    border: 1px solid var(--line); border-radius: 3px; padding: 1px 5px; }
  #status {
    text-align: center; color: var(--muted); font-size: 12px; padding: 4px 16px;
    font-family: ui-monospace, Menlo, monospace;
  }
  #status.error { color: #c00; }
</style>
</head>
<body>
  <header>
    <div>
      <span class="brand">YDI Agenda</span>
      <span class="sub">preview harness · localhost:${PORT}</span>
    </div>
    <div class="modes" role="tablist">
      <button id="mode-fixture" class="active" type="button">Fixture</button>
      <button id="mode-live" type="button">Live</button>
    </div>
  </header>
  <div id="status">connecting…</div>
  <div class="wrap">
    <div class="frame">
      <iframe id="widget" src="/widget" title="YDI Agenda widget"></iframe>
    </div>
  </div>
  <footer>
    Fixture: canned 10-todo payload. · Live: reads <kbd>~/.config/yesdidit/config.json</kbd> JWT and hits the real API.<br>
    Complete + snooze clicks round-trip to the real API in Live mode only.
  </footer>
<script type="module">
  import { AppBridge, PostMessageTransport } from "https://esm.sh/@modelcontextprotocol/ext-apps@1?bundle";

  const iframe = document.getElementById("widget");
  const btnF = document.getElementById("mode-fixture");
  const btnL = document.getElementById("mode-live");
  const statusEl = document.getElementById("status");

  let mode = "fixture";
  let bridge = null;
  let initialized = false;

  function setStatus(msg, isError) {
    statusEl.textContent = msg;
    statusEl.classList.toggle("error", !!isError);
  }

  async function fetchResult(m) {
    const url = m === "live" ? "/live/agenda.json" : "/fixtures/agenda.json";
    const r = await fetch(url, { credentials: "same-origin" });
    if (!r.ok) {
      const text = await r.text().catch(() => "");
      throw new Error("fetch " + url + " failed: HTTP " + r.status + " " + text);
    }
    return r.json();
  }

  async function pushResult() {
    if (!bridge || !initialized) return;
    try {
      setStatus("loading " + mode + "…");
      const result = await fetchResult(mode);
      await bridge.sendToolResult(result);
      setStatus("connected · " + mode);
    } catch (err) {
      const msg = err && err.message ? err.message : String(err);
      console.error("[preview] pushResult failed:", err);
      setStatus("error: " + msg, true);
    }
  }

  function setMode(next) {
    if (next === mode) return;
    mode = next;
    btnF.classList.toggle("active", mode === "fixture");
    btnL.classList.toggle("active", mode === "live");
    pushResult();
  }

  btnF.addEventListener("click", () => setMode("fixture"));
  btnL.addEventListener("click", () => setMode("live"));

  // Build the bridge once the iframe document is ready. The iframe's
  // contentWindow exists from creation time, but we wait for "load" so the
  // widget's <script type="module"> has begun executing — the widget's
  // app.connect() will await our initialize response over postMessage, so
  // exact timing doesn't matter as long as our message listener is up
  // before the response is needed.
  iframe.addEventListener("load", async () => {
    try {
      bridge = new AppBridge(
        null,
        { name: "ydi-preview", version: "1.0.0" },
        { serverTools: {} }
      );
      bridge.oninitialized = async () => {
        try {
          await bridge.sendToolInput({ arguments: {} });
          initialized = true;
          await pushResult();
        } catch (err) {
          console.error("[preview] oninitialized:", err);
          setStatus("error: " + (err && err.message ? err.message : String(err)), true);
        }
      };
      bridge.oncalltool = async (params) => {
        const url = mode === "live" ? "/live/call" : "/fixtures/call";
        const r = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: params.name, args: params.arguments ?? {} }),
        });
        if (!r.ok) {
          const text = await r.text().catch(() => "");
          throw new Error(text || ("HTTP " + r.status));
        }
        await r.json().catch(() => null);
        // After a mutation in live mode, refresh the agenda so the widget
        // reflects the new state.
        if (mode === "live") {
          fetchResult("live").then((next) => bridge.sendToolResult(next)).catch((e) =>
            console.error("[preview] live refresh failed:", e)
          );
        }
        return { content: [{ type: "text", text: "ok" }] };
      };

      const target = iframe.contentWindow;
      if (!target) throw new Error("iframe has no contentWindow");
      const transport = new PostMessageTransport(target, target);
      await bridge.connect(transport);
      setStatus("connected · " + mode);
    } catch (err) {
      console.error("[preview] bridge setup failed:", err);
      setStatus("bridge setup failed: " + (err && err.message ? err.message : String(err)), true);
    }
  });
</script>
</body>
</html>`;

// ── Live-mode handlers (hit real API via existing stdio auth path) ──────────

type AgendaRow = {
  id: string;
  text: string;
  due_at: string | null;
  bucket: "overdue" | "today" | "week";
  tags: string[];
  branch: string | null;
  repo_slug: string | null;
};

async function fetchLiveAgenda(): Promise<AgendaRow[]> {
  const [overdue, today, week] = await Promise.all([
    listTodos({ filter: "overdue", status: "pending", limit: 200 }),
    listTodos({ filter: "today", status: "pending", limit: 200 }),
    listTodos({ filter: "this-week", status: "pending", limit: 200 }),
  ]);

  const byId = new Map<string, AgendaRow>();
  const push = (t: Todo, bucket: AgendaRow["bucket"]) => {
    // Priority: overdue > today > week. First-write-wins given iteration order.
    if (byId.has(t.id)) return;
    byId.set(t.id, {
      id: t.id,
      text: t.text,
      due_at: t.due_at,
      bucket,
      tags: t.tags,
      branch: t.context?.branch ?? null,
      repo_slug: t.context?.repo ?? null,
    });
  };
  overdue.forEach((t) => push(t, "overdue"));
  today.forEach((t) => push(t, "today"));
  week.forEach((t) => push(t, "week"));
  return Array.from(byId.values());
}

function buildResult(todos: AgendaRow[]) {
  return {
    content: [
      { type: "text", text: `${todos.length} active todos` },
      { type: "text", text: "Agenda preview · live" },
    ],
    structuredContent: {
      summary: `${todos.length} active todos`,
      counts: {
        overdue: todos.filter((t) => t.bucket === "overdue").length,
        today: todos.filter((t) => t.bucket === "today").length,
        this_week: todos.filter((t) => t.bucket === "week").length,
      },
    },
    _meta: {
      "ydi.todos": todos,
      "ydi.server_time": new Date().toISOString(),
    },
  };
}

// The fixture payload doesn't carry `content` (the widget reads only _meta),
// but a CallToolResult needs at least one content item to be valid MCP. Patch
// it in here so we don't have to mutate the fixture file.
function withContent<T extends { _meta?: unknown }>(result: T) {
  return {
    content: [{ type: "text", text: "Agenda preview · fixture" }],
    ...result,
  };
}

// ── HTTP plumbing ───────────────────────────────────────────────────────────

function send(
  res: ServerResponse,
  status: number,
  body: string | Buffer,
  contentType = "text/plain; charset=utf-8"
) {
  res.writeHead(status, { "Content-Type": contentType, "Cache-Control": "no-store" });
  res.end(body);
}

function sendJson(res: ServerResponse, status: number, body: unknown) {
  send(res, status, JSON.stringify(body), "application/json; charset=utf-8");
}

async function readBody(req: IncomingMessage): Promise<string> {
  const chunks: Uint8Array[] = [];
  for await (const chunk of req) chunks.push(chunk as Uint8Array);
  return Buffer.concat(chunks).toString("utf8");
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", `http://localhost:${PORT}`);
  const method = req.method ?? "GET";
  const pathname = url.pathname;

  try {
    // Preview page
    if (method === "GET" && pathname === "/") {
      return send(res, 200, previewPageHtml, "text/html; charset=utf-8");
    }

    // Widget — served exactly as production, just with the bundle URL
    // pointed at the local preview server. The parent page wires up
    // AppBridge over postMessage; no per-mode injection.
    if (method === "GET" && pathname === "/widget") {
      const { hash } = getWidgetAppAsset();
      const widgetAppUrl = `http://localhost:${PORT}/widget-app/${hash}.js`;
      return send(res, 200, buildAgendaHtml(widgetAppUrl), "text/html; charset=utf-8");
    }

    // Self-hosted MCP Apps SDK bundle — same file the prod API serves.
    if (method === "GET" && pathname.startsWith("/widget-app/")) {
      const { js } = getWidgetAppAsset();
      res.writeHead(200, {
        "Content-Type": "application/javascript; charset=utf-8",
        "Access-Control-Allow-Origin": "*",
        "Cache-Control": "no-store",
      });
      res.end(js);
      return;
    }

    // Fixture endpoints
    if (method === "GET" && pathname === "/fixtures/agenda.json") {
      return sendJson(res, 200, withContent(fixtureResult));
    }
    if (method === "POST" && pathname === "/fixtures/call") {
      const raw = await readBody(req);
      let payload: { name?: string; args?: unknown } = {};
      try {
        payload = JSON.parse(raw);
      } catch {
        return sendJson(res, 400, { error: "invalid json" });
      }
      // eslint-disable-next-line no-console
      console.log("[preview] fixture call:", payload.name, payload.args);
      return sendJson(res, 200, { ok: true, mode: "fixture", echo: payload });
    }

    // Live endpoints (hit real API via the existing api-client)
    if (method === "GET" && pathname === "/live/agenda.json") {
      try {
        const todos = await fetchLiveAgenda();
        return sendJson(res, 200, buildResult(todos));
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        // eslint-disable-next-line no-console
        console.error("[preview] live agenda failed:", msg);
        return sendJson(res, 500, { error: msg });
      }
    }
    if (method === "POST" && pathname === "/live/call") {
      const raw = await readBody(req);
      let payload: { name?: string; args?: Record<string, unknown> } = {};
      try {
        payload = JSON.parse(raw);
      } catch {
        return sendJson(res, 400, { error: "invalid json" });
      }
      const { name, args } = payload;
      // eslint-disable-next-line no-console
      console.log("[preview] live call:", name, args);
      try {
        if (name === "complete_todo") {
          const id = String(args?.id ?? "");
          if (!id) return sendJson(res, 400, { error: "missing id" });
          const todo = await completeTodo(id);
          return sendJson(res, 200, { ok: true, todo });
        }
        if (name === "update_todo") {
          const id = String(args?.id ?? "");
          if (!id) return sendJson(res, 400, { error: "missing id" });
          const body: { text?: string; due_at?: string | null; tags?: string[] } = {};
          if (typeof args?.text === "string") body.text = args.text;
          if (args?.due_at === null || typeof args?.due_at === "string") {
            body.due_at = args.due_at as string | null;
          }
          if (Array.isArray(args?.tags)) body.tags = args!.tags as string[];
          const todo = await updateTodo(id, body);
          return sendJson(res, 200, { ok: true, todo });
        }
        return sendJson(res, 400, { error: `unsupported tool: ${name}` });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        // eslint-disable-next-line no-console
        console.error("[preview] live call failed:", msg);
        return sendJson(res, 500, { error: msg });
      }
    }

    // 404
    send(res, 404, "not found");
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    // eslint-disable-next-line no-console
    console.error("[preview] handler error:", msg);
    send(res, 500, msg);
  }
});

server.listen(PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`\n  YDI agenda preview harness → http://localhost:${PORT}\n`);
  // eslint-disable-next-line no-console
  console.log("  Fixture mode: canned 10-todo payload, no network.");
  // eslint-disable-next-line no-console
  console.log("  Live mode:    reads ~/.config/yesdidit/config.json and hits the real API.\n");
});
