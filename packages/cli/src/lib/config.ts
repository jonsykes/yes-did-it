import { readFileSync, writeFileSync, unlinkSync, mkdirSync } from "fs"
import { homedir } from "os"
import { join } from "path"

export function getConfigDir(): string {
  return process.env.YDI_CONFIG_DIR ?? join(homedir(), ".config", "yesdidit")
}

function getConfigFile(): string {
  return join(getConfigDir(), "config.json")
}

export type Config = {
  access_token: string
  refresh_token: string
  expires_at: number // Unix timestamp (seconds)
  user: {
    id: string
    email: string
    name: string | null
    avatar_url: string | null
  }
}

export function readConfig(): Config | null {
  try {
    const raw = readFileSync(getConfigFile(), "utf8")
    const parsed = JSON.parse(raw)
    if (!parsed.access_token) return null
    return parsed as Config
  } catch {
    return null
  }
}

export function writeConfig(config: Config): void {
  mkdirSync(getConfigDir(), { recursive: true })
  writeFileSync(getConfigFile(), JSON.stringify(config, null, 2), { mode: 0o600 })
}

export function clearConfig(): void {
  try {
    unlinkSync(getConfigFile())
  } catch {
    // already gone
  }
}

/** Decode the exp claim from a JWT without verifying the signature. */
export function jwtExpiry(token: string): number {
  try {
    const payload = JSON.parse(
      Buffer.from(token.split(".")[1], "base64url").toString()
    )
    return payload.exp as number
  } catch {
    return 0
  }
}
