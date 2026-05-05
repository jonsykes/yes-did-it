/**
 * Vitest global setup for CLI integration tests.
 *
 * Starts a local API server with a test database, creates test credentials,
 * and writes a temp config file so CLI tests never touch production or
 * personal accounts.
 */

import { spawn, type ChildProcess } from "child_process"
import { mkdirSync, writeFileSync, rmSync, readFileSync } from "fs"
import { tmpdir } from "os"
import { join, resolve } from "path"

const TEST_USER_ID = "00000000-0000-0000-0000-000000000005"
const TEST_EMAIL = "cli-test@yesdidit.com"
const API_PORT = 3987 // Unusual port to avoid conflicts

function loadEnv() {
  try {
    const content = readFileSync(resolve(__dirname, "../../../../.env"), "utf8")
    for (const line of content.split("\n")) {
      const trimmed = line.trim()
      if (!trimmed || trimmed.startsWith("#")) continue
      const eqIdx = trimmed.indexOf("=")
      if (eqIdx === -1) continue
      const key = trimmed.slice(0, eqIdx).trim()
      let val = trimmed.slice(eqIdx + 1).trim()
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
        val = val.slice(1, -1)
      }
      if (!process.env[key]) {
        process.env[key] = val
      }
    }
  } catch {
    // No .env file — CI provides env vars directly
  }
}

async function signJwt(secret: string): Promise<string> {
  // Inline JWT signing to avoid importing jose (API dependency)
  const header = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url")
  const now = Math.floor(Date.now() / 1000)
  const payload = Buffer.from(
    JSON.stringify({ sub: TEST_USER_ID, email: TEST_EMAIL, iat: now, exp: now + 7200 })
  ).toString("base64url")
  const { createHmac } = await import("crypto")
  const sig = createHmac("sha256", secret)
    .update(`${header}.${payload}`)
    .digest("base64url")
  return `${header}.${payload}.${sig}`
}

async function waitForServer(url: string, timeoutMs = 10000): Promise<void> {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(url)
      if (res.ok) return
    } catch {
      // Server not ready yet
    }
    await new Promise((r) => setTimeout(r, 100))
  }
  throw new Error(`Server at ${url} did not start within ${timeoutMs}ms`)
}

async function query(databaseUrl: string, sql: string, params: string[] = []): Promise<void> {
  // Use postgres package directly via dynamic import from the API package
  const pg = (await import("postgres")).default
  const client = pg(databaseUrl, { max: 1 })
  await client.unsafe(sql, params)
  await client.end()
}

export async function setup() {
  loadEnv()

  const JWT_SECRET = process.env.JWT_SECRET
  const DATABASE_URL = process.env.DATABASE_URL

  if (!JWT_SECRET || !DATABASE_URL) {
    throw new Error(
      "CLI test global setup requires JWT_SECRET and DATABASE_URL env vars. " +
      "Set them in the root .env file or export them in your shell."
    )
  }

  // 1. Insert test user into the database
  await query(DATABASE_URL, `DELETE FROM users WHERE id = $1`, [TEST_USER_ID])
  await query(DATABASE_URL, `INSERT INTO users (id, email) VALUES ($1, $2)`, [TEST_USER_ID, TEST_EMAIL])

  // 2. Sign a test JWT
  const token = await signJwt(JWT_SECRET)

  // 3. Write temp config file
  const configDir = join(tmpdir(), `ydi-cli-test-${Date.now()}`)
  mkdirSync(configDir, { recursive: true })
  writeFileSync(
    join(configDir, "config.json"),
    JSON.stringify({
      access_token: token,
      refresh_token: "test-refresh-not-used",
      expires_at: Math.floor(Date.now() / 1000) + 7200,
      user: { id: TEST_USER_ID, email: TEST_EMAIL, name: "CLI Test", avatar_url: null },
    })
  )

  // 4. Start a local API server as a child process using tsx
  const apiDir = resolve(__dirname, "../../../../packages/api")
  const tsxBin = join(apiDir, "node_modules/.bin/tsx")
  const serverScript = join(apiDir, "src/server.ts")
  const serverProcess: ChildProcess = spawn(
    tsxBin,
    [serverScript],
    {
      cwd: apiDir,
      env: { ...process.env, DATABASE_URL, JWT_SECRET, PORT: String(API_PORT) },
      stdio: ["ignore", "pipe", "pipe"],
    }
  )

  // Wait for the server to be ready
  await waitForServer(`http://localhost:${API_PORT}/api/health`)

  // 5. Set env vars so spawned CLI processes use the local server + temp config
  process.env.YDI_API_URL = `http://localhost:${API_PORT}`
  process.env.YDI_CONFIG_DIR = configDir

  return async function teardown() {
    serverProcess.kill()
    await query(DATABASE_URL, `DELETE FROM todos WHERE user_id = $1`, [TEST_USER_ID])
    await query(DATABASE_URL, `DELETE FROM api_keys WHERE user_id = $1`, [TEST_USER_ID])
    await query(DATABASE_URL, `DELETE FROM users WHERE id = $1`, [TEST_USER_ID])
    rmSync(configDir, { recursive: true, force: true })
  }
}
