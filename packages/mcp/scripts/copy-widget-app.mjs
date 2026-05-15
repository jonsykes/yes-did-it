// Post-tsc step: copy @modelcontextprotocol/ext-apps's pre-bundled
// browser-ready file into dist/widgets/widget-app.js. The widget iframe
// imports this file from api.yesdidit.com instead of esm.sh — pinning all
// transitive deps (zod, SDK) to whatever pnpm resolved at build time.
//
// Background: see library/postmortem-2026-04-26-mcp-esm-outage.md and the
// follow-on widget outage caused by esm.sh resolving zod@4 to a version
// missing `.custom`.

import { copyFileSync, mkdirSync, statSync } from "node:fs"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { createRequire } from "node:module"

const require = createRequire(import.meta.url)
const src = require.resolve("@modelcontextprotocol/ext-apps/app-with-deps")

const here = dirname(fileURLToPath(import.meta.url))
const dest = resolve(here, "..", "dist", "widgets", "widget-app.js")

mkdirSync(dirname(dest), { recursive: true })
copyFileSync(src, dest)

const sizeKb = (statSync(dest).size / 1024).toFixed(1)
console.log(`[copy-widget-app] ${sizeKb}KB → ${dest}`)
