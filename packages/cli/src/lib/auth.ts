import { createServer } from "http"
import { createHash, randomBytes } from "crypto"
import { exec } from "child_process"
import { writeConfig, jwtExpiry } from "./config"

const SUPABASE_URL = "https://slpfcjgnhadtdmatbqog.supabase.co"
const SUPABASE_ANON_KEY = "sb_publishable_O-fVSltoH5kA74rwnRd1qw_excts6TD"
const API_URL = "https://api.yesdidit.com"
const WEB_URL = "https://yesdidit.com"
const REDIRECT_PORT = 7777
// Route through the web app's bridge endpoint so the redirect URL is on a
// domain Supabase already trusts. The bridge forwards ?code= to localhost.
const REDIRECT_URI = `${WEB_URL}/api/auth/cli-callback`

type Provider = "google" | "github"

function generateCodeVerifier(): string {
  return randomBytes(64).toString("base64url")
}

function generateCodeChallenge(verifier: string): string {
  return createHash("sha256").update(verifier).digest("base64url")
}

function openBrowser(url: string): void {
  const cmd =
    process.platform === "darwin"
      ? `open "${url}"`
      : process.platform === "win32"
        ? `start "" "${url}"`
        : `xdg-open "${url}"`
  exec(cmd)
}

/** Wait for the OAuth callback on localhost:7777 and return the auth code. */
function waitForCallback(): Promise<string> {
  return new Promise((resolve, reject) => {
    const server = createServer((req, res) => {
      const url = new URL(req.url ?? "/", `http://localhost:${REDIRECT_PORT}`)
      const code = url.searchParams.get("code")
      const error = url.searchParams.get("error")

      const html = code
        ? `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Yes! Did It</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      background: #fafafa;
      display: flex;
      align-items: center;
      justify-content: center;
      min-height: 100vh;
      color: #111;
    }
    .card {
      background: #fff;
      border: 1px solid #e5e5e5;
      border-radius: 12px;
      padding: 48px 56px;
      text-align: center;
      max-width: 420px;
      width: 90%;
    }
    .check {
      font-size: 48px;
      margin-bottom: 16px;
    }
    h1 { font-size: 22px; font-weight: 600; margin-bottom: 10px; }
    p  { font-size: 15px; color: #555; line-height: 1.5; }
  </style>
</head>
<body>
  <div class="card">
    <div class="check">✓</div>
    <h1>Logged in to Yes! Did It</h1>
    <p>You can close this tab and return to your terminal.</p>
  </div>
</body>
</html>`
        : `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>Login failed</title>
  <style>
    body { font-family: -apple-system, sans-serif; display: flex; align-items: center;
           justify-content: center; min-height: 100vh; background: #fafafa; }
    .card { background: #fff; border: 1px solid #e5e5e5; border-radius: 12px;
            padding: 48px 56px; text-align: center; max-width: 420px; }
    h1 { font-size: 20px; margin-bottom: 10px; }
    p  { color: #888; font-size: 14px; }
  </style>
</head>
<body>
  <div class="card">
    <h1>Login failed</h1>
    <p>${error ?? "Unknown error"}</p>
  </div>
</body>
</html>`

      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" })
      res.end(html)
      server.close()

      if (code) resolve(code)
      else reject(new Error(`OAuth error: ${error ?? "no code returned"}`))
    })

    server.on("error", reject)
    server.listen(REDIRECT_PORT)
  })
}

export type LoginResult = {
  email: string
  name: string | null
}

export async function login(provider: Provider = "google"): Promise<LoginResult> {
  const codeVerifier = generateCodeVerifier()
  const codeChallenge = generateCodeChallenge(codeVerifier)

  const authUrl = new URL(`${SUPABASE_URL}/auth/v1/authorize`)
  authUrl.searchParams.set("provider", provider)
  authUrl.searchParams.set("redirect_to", REDIRECT_URI)
  authUrl.searchParams.set("code_challenge", codeChallenge)
  authUrl.searchParams.set("code_challenge_method", "S256")

  // Start server before opening browser so we don't miss the callback
  const callbackPromise = waitForCallback()
  openBrowser(authUrl.toString())

  const authCode = await callbackPromise

  // Exchange auth code + verifier for Supabase tokens
  const tokenRes = await fetch(
    `${SUPABASE_URL}/auth/v1/token?grant_type=pkce`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: SUPABASE_ANON_KEY,
      },
      body: JSON.stringify({ auth_code: authCode, code_verifier: codeVerifier }),
    }
  )

  if (!tokenRes.ok) {
    const err = await tokenRes.text()
    throw new Error(`Supabase token exchange failed: ${err}`)
  }

  const { access_token: supabaseJwt } = (await tokenRes.json()) as {
    access_token: string
  }

  // Exchange Supabase JWT for app JWT
  const appRes = await fetch(`${API_URL}/api/auth/token`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ access_token: supabaseJwt }),
  })

  if (!appRes.ok) {
    const err = await appRes.text()
    throw new Error(`App token exchange failed: ${err}`)
  }

  const appData = (await appRes.json()) as {
    access_token: string
    refresh_token: string
    user: { id: string; email: string; name: string | null; avatar_url: string | null }
  }

  writeConfig({
    access_token: appData.access_token,
    refresh_token: appData.refresh_token,
    expires_at: jwtExpiry(appData.access_token),
    user: appData.user,
  })

  return { email: appData.user.email, name: appData.user.name }
}
