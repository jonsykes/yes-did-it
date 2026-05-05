/**
 * Builds the YDI agenda widget HTML, parameterized by the URL of the
 * MCP Apps SDK bundle to import.
 *
 * Rendered in an iframe by MCP Apps hosts (Claude.ai, ChatGPT). The bundle
 * is self-hosted on api.yesdidit.com (see widget-app-asset.ts) — we used
 * to pull it from esm.sh, but esm.sh resolved transitive zod to a broken
 * v4 and the widget went blank. The host's CSP is widened to allow our
 * own origin via the `_meta.ui.csp` entry on the resource registration
 * in server.ts.
 */
export function buildAgendaHtml(widgetAppUrl: string): string {
  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<title>YDI Agenda</title>
<style>
  :root {
    --bg: #ffffff;
    --fg: #111111;
    --muted: #6b6b6b;
    --line: #ececec;
    --overdue: #e01e1e;
    --today: #f59e0b;
    --week: #c4c4c4;
    --accent: #111111;
  }
  @media (prefers-color-scheme: dark) {
    :root {
      --bg: #1a1a1a;
      --fg: #f5f5f5;
      --muted: #9a9a9a;
      --line: #2a2a2a;
      --accent: #f5f5f5;
    }
  }
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; background: var(--bg); color: var(--fg); }
  body {
    padding: 14px 16px 28px;
    font: 14px/1.45 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
  }
  h2 {
    font-size: 11px; font-weight: 600;
    text-transform: uppercase; letter-spacing: 0.08em;
    color: var(--muted);
    margin: 18px 0 6px;
  }
  h2:first-of-type { margin-top: 0; }
  h2 .count { font-weight: 400; margin-left: 4px; }
  .row {
    display: flex; align-items: flex-start; gap: 10px;
    padding: 10px 8px 10px 10px;
    border-bottom: 1px solid var(--line);
    border-left: 3px solid transparent;
    transition: opacity 0.15s ease;
  }
  .row.bucket-overdue { border-left-color: var(--overdue); }
  .row.bucket-today   { border-left-color: var(--today); }
  .row.bucket-week    { border-left-color: var(--week); }
  .row.done { opacity: 0.4; }
  .row.done .text { text-decoration: line-through; }
  .row input[type="checkbox"] {
    margin: 2px 0 0; cursor: pointer;
    accent-color: var(--accent);
    width: 16px; height: 16px;
  }
  .body { flex: 1; min-width: 0; }
  .text { word-break: break-word; }
  .meta {
    margin-top: 3px;
    font: 11px/1.3 ui-monospace, SFMono-Regular, Menlo, monospace;
    color: var(--muted);
  }
  .due { font-size: 11px; color: var(--muted); margin-left: 6px; }
  select {
    font: inherit; font-size: 12px;
    color: var(--muted);
    background: transparent;
    border: 1px solid var(--line);
    border-radius: 5px;
    padding: 4px 6px;
    cursor: pointer;
    min-width: 80px;
  }
  select:hover, select:focus {
    color: var(--fg);
    border-color: var(--muted);
    outline: none;
  }
  .empty {
    padding: 32px 12px; text-align: center;
    color: var(--muted); font-style: italic;
  }
  .toast {
    position: fixed; bottom: 12px; right: 12px;
    background: var(--fg); color: var(--bg);
    padding: 7px 12px; border-radius: 6px;
    font-size: 12px;
    opacity: 0; transform: translateY(4px);
    transition: opacity 0.18s ease, transform 0.18s ease;
    pointer-events: none;
    max-width: 260px;
  }
  .toast.show { opacity: 0.92; transform: translateY(0); }
  .toast.error { background: #c00; color: #fff; opacity: 0.95; }
</style>
</head>
<body>
  <div id="root"></div>
  <div id="toast" class="toast" role="status" aria-live="polite"></div>
<script type="module">
  const { App } = await import("${widgetAppUrl}");

  "use strict";

  const BUCKET_LABELS = { overdue: "Overdue", today: "Today", week: "This week" };
  const BUCKET_ORDER = ["overdue", "today", "week"];

  let todosCache = [];

  function escapeHtml(s) {
    if (s == null) return "";
    return String(s).replace(/[&<>"']/g, function (c) {
      return ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c];
    });
  }

  // Client-side snooze resolution: sets due_at to 17:00 local on the target day.
  // Server stores ISO, so we pick a concrete date here rather than asking the
  // server to parse "tomorrow" / "friday" / "next week".
  function resolveSnooze(when) {
    var now = new Date();
    var d = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 17, 0, 0, 0);
    if (when === "tomorrow") {
      d.setDate(d.getDate() + 1);
    } else if (when === "friday") {
      var dow = d.getDay();
      var add = (5 - dow + 7) % 7;
      if (add === 0) add = 7;
      d.setDate(d.getDate() + add);
    } else if (when === "next week") {
      d.setDate(d.getDate() + 7);
    } else {
      return null;
    }
    return d.toISOString();
  }

  function formatDue(iso) {
    if (!iso) return "";
    try {
      var d = new Date(iso);
      if (isNaN(d.getTime())) return "";
      return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
    } catch (e) {
      return "";
    }
  }

  var toastTimer = null;
  function flashToast(msg, isError) {
    var el = document.getElementById("toast");
    if (!el) return;
    el.textContent = msg;
    el.classList.toggle("error", !!isError);
    el.classList.add("show");
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.classList.remove("show"); }, 1800);
  }

  const app = new App({ name: "ydi-agenda", version: "1.0.0" });

  app.ontoolresult = (result) => {
    const next = result && result._meta && Array.isArray(result._meta["ydi.todos"])
      ? result._meta["ydi.todos"]
      : [];
    todosCache = next;
    render();
  };
  app.onerror = (err) => {
    console.error("[ydi-agenda]", err);
  };

  function callTool(name, args) {
    return app.callServerTool({ name: name, arguments: args });
  }

  function rowHtml(t) {
    var metaBits = [];
    if (t.repo_slug) metaBits.push(escapeHtml(t.repo_slug));
    if (t.branch) metaBits.push(escapeHtml(t.branch));
    if (Array.isArray(t.tags) && t.tags.length) {
      metaBits.push(t.tags.map(function (tg) { return "#" + escapeHtml(tg); }).join(" "));
    }
    var metaRow = metaBits.length ? '<div class="meta">' + metaBits.join(" · ") + "</div>" : "";
    var due = formatDue(t.due_at);
    var dueStr = due ? '<span class="due">' + escapeHtml(due) + "</span>" : "";
    var bucket = (t.bucket === "overdue" || t.bucket === "today" || t.bucket === "week") ? t.bucket : "week";

    return (
      '<div class="row bucket-' + bucket + '" data-id="' + escapeHtml(t.id) + '">' +
        '<input type="checkbox" data-action="complete" aria-label="Mark done">' +
        '<div class="body">' +
          '<div class="text">' + escapeHtml(t.text) + dueStr + "</div>" +
          metaRow +
        "</div>" +
        '<select data-action="snooze" aria-label="Snooze">' +
          '<option value="">snooze…</option>' +
          '<option value="tomorrow">Tomorrow</option>' +
          '<option value="friday">Friday</option>' +
          '<option value="next week">Next week</option>' +
        "</select>" +
      "</div>"
    );
  }

  function bucketHtml(bucket, items) {
    if (!items.length) return "";
    return (
      "<h2>" + escapeHtml(BUCKET_LABELS[bucket]) +
        '<span class="count">(' + items.length + ")</span>" +
      "</h2>" +
      items.map(rowHtml).join("")
    );
  }

  function render() {
    var root = document.getElementById("root");
    if (!root) return;
    var todos = todosCache;

    if (!todos.length) {
      root.innerHTML = '<div class="empty">Nothing due. Inbox zero. 🎉</div>';
      return;
    }

    var byBucket = { overdue: [], today: [], week: [] };
    for (var i = 0; i < todos.length; i++) {
      var t = todos[i];
      var b = byBucket[t.bucket] ? t.bucket : "week";
      byBucket[b].push(t);
    }

    root.innerHTML = BUCKET_ORDER.map(function (b) { return bucketHtml(b, byBucket[b]); }).join("");
  }

  document.addEventListener("change", async function (e) {
    var target = e.target;
    if (!target || !target.getAttribute) return;
    var action = target.getAttribute("data-action");
    if (!action) return;
    var row = target.closest(".row");
    if (!row) return;
    var id = row.getAttribute("data-id");
    if (!id) return;

    if (action === "complete") {
      if (!target.checked) return;
      target.disabled = true;
      try {
        await callTool("complete_todo", { id: id });
        row.classList.add("done");
        flashToast("Completed");
      } catch (err) {
        target.checked = false;
        target.disabled = false;
        flashToast("Failed: " + (err && err.message ? err.message : "error"), true);
      }
      return;
    }

    if (action === "snooze") {
      var when = target.value;
      if (!when) return;
      var dueAt = resolveSnooze(when);
      if (!dueAt) { target.value = ""; return; }
      target.disabled = true;
      try {
        await callTool("update_todo", { id: id, due_at: dueAt });
        flashToast("Snoozed to " + when);
      } catch (err) {
        flashToast("Failed: " + (err && err.message ? err.message : "error"), true);
      } finally {
        target.value = "";
        target.disabled = false;
      }
    }
  });

  render();

  try {
    await app.connect();
  } catch (err) {
    console.error("[ydi-agenda] connect failed:", err);
  }
</script>
</body>
</html>`
}
