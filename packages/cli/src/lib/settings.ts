import { readFileSync, writeFileSync, mkdirSync } from "fs"
import { join } from "path"
import { CONFIG_DIR } from "./config"

const SETTINGS_FILE = join(CONFIG_DIR, "settings.json")

export type SettingKey =
  | "context.auto"
  | "timezone"
  | "default_filter"
  | "date_format"
  | "color"
  | "verbose"
  | "standup.since"

type SettingValue = string | boolean

const DEFAULTS: Record<SettingKey, SettingValue> = {
  "context.auto": true,
  timezone: "UTC",
  default_filter: "pending",
  date_format: "relative",
  color: "auto",
  verbose: false,
  "standup.since": "24h",
}

const VALID_VALUES: Partial<Record<SettingKey, string[]>> = {
  default_filter: ["pending", "today", "all"],
  date_format: ["relative", "iso", "short", "local"],
  color: ["auto", "always", "never"],
}

const BOOLEAN_KEYS: SettingKey[] = ["context.auto", "verbose"]

export function isValidKey(key: string): key is SettingKey {
  return key in DEFAULTS
}

function readRawSettings(): Record<string, SettingValue> {
  try {
    return JSON.parse(readFileSync(SETTINGS_FILE, "utf8"))
  } catch {
    return {}
  }
}

export function readSettings(): Record<SettingKey, SettingValue> {
  const raw = readRawSettings()
  return { ...DEFAULTS, ...raw }
}

export function getSetting<K extends SettingKey>(key: K): (typeof DEFAULTS)[K] {
  const settings = readSettings()
  return settings[key] as (typeof DEFAULTS)[K]
}

export function isExplicitlySet(key: SettingKey): boolean {
  const raw = readRawSettings()
  return key in raw
}

export function validateSetting(key: string, value: string): { key: SettingKey; parsed: SettingValue } {
  if (!isValidKey(key)) {
    const keys = Object.keys(DEFAULTS).join(", ")
    throw new Error(`Unknown setting: "${key}". Valid settings: ${keys}`)
  }

  if (BOOLEAN_KEYS.includes(key)) {
    if (value === "true") return { key, parsed: true }
    if (value === "false") return { key, parsed: false }
    throw new Error(`"${key}" must be "true" or "false"`)
  }

  const allowed = VALID_VALUES[key]
  if (allowed && !allowed.includes(value)) {
    throw new Error(`"${key}" must be one of: ${allowed.join(", ")}`)
  }

  if (key === "timezone") {
    try {
      Intl.DateTimeFormat(undefined, { timeZone: value })
    } catch {
      throw new Error(`Invalid timezone: "${value}". Use an IANA timezone like "America/New_York" or "UTC".`)
    }
  }

  return { key, parsed: value }
}

export function setSetting(key: SettingKey, value: SettingValue): void {
  const raw = readRawSettings()
  raw[key] = value
  mkdirSync(CONFIG_DIR, { recursive: true })
  writeFileSync(SETTINGS_FILE, JSON.stringify(raw, null, 2), { mode: 0o600 })
}

export function getDefaults(): Record<SettingKey, SettingValue> {
  return { ...DEFAULTS }
}

/** Check if color output should be enabled based on settings and environment. */
export function shouldUseColor(): boolean {
  const setting = getSetting("color")
  if (setting === "always") return true
  if (setting === "never") return false
  // "auto": check TTY and NO_COLOR env var
  return process.stdout.isTTY === true && !process.env.NO_COLOR
}
