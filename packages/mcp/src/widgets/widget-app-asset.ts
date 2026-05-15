// Self-hosted MCP Apps SDK bundle. In production the `widget-app.js`
// sibling is copied from `@modelcontextprotocol/ext-apps/app-with-deps`
// by the post-tsc copy script (scripts/copy-widget-app.mjs). The widget
// iframe imports it from `https://api.yesdidit.com/mcp/widget-app/<hash>.js`,
// served by the API route in packages/api/src/routes/mcp.ts.
//
// The `new URL("./widget-app.js", import.meta.url)` form is what
// @vercel/node's node-file-trace recognises as an asset reference — it
// keeps the file in the deployed function bundle. When running from
// source (preview harness, tests) the sibling won't exist; we fall back
// to resolving directly from node_modules.

import { existsSync, readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { createHash } from "node:crypto"
import { createRequire } from "node:module"

let cached: { js: Uint8Array; hash: string } | null = null

function resolveBundlePath(): string {
  const sibling = fileURLToPath(new URL("./widget-app.js", import.meta.url))
  if (existsSync(sibling)) return sibling
  const require = createRequire(import.meta.url)
  return require.resolve("@modelcontextprotocol/ext-apps/app-with-deps")
}

export function getWidgetAppAsset(): { js: Uint8Array; hash: string } {
  if (cached) return cached
  const js = new Uint8Array(readFileSync(resolveBundlePath()))
  const hash = createHash("sha256").update(js).digest("hex").slice(0, 12)
  cached = { js, hash }
  return cached
}
