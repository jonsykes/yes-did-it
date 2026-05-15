/**
 * Unit tests for the settings module.
 * Sets YDI_CONFIG_DIR to a temp directory before importing settings,
 * so no real config is touched.
 */

import { mkdtempSync, rmSync } from "fs"
import { join } from "path"
import { tmpdir } from "os"

// Set env before importing settings so CONFIG_DIR picks it up
const tempDir = mkdtempSync(join(tmpdir(), "ydi-settings-test-"))
process.env.YDI_CONFIG_DIR = tempDir

import { describe, it, expect, afterAll, beforeEach } from "vitest"
import {
  readSettings,
  getSetting,
  setSetting,
  isExplicitlySet,
  isValidKey,
  validateSetting,
  shouldUseColor,
  getDefaults,
  type SettingKey,
} from "../lib/settings"

// Clean the settings file between tests so they don't leak
beforeEach(() => {
  try {
    rmSync(join(tempDir, "settings.json"))
  } catch { /* doesn't exist yet */ }
})

afterAll(() => {
  try {
    rmSync(tempDir, { recursive: true })
  } catch { /* already gone */ }
  delete process.env.YDI_CONFIG_DIR
})

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

describe("defaults", () => {
  it("readSettings returns all defaults when no file exists", () => {
    const settings = readSettings()
    expect(settings["context.auto"]).toBe(true)
    expect(settings.timezone).toBe("UTC")
    expect(settings.default_filter).toBe("pending")
    expect(settings.date_format).toBe("relative")
    expect(settings.color).toBe("auto")
    expect(settings.verbose).toBe(false)
    expect(settings["standup.since"]).toBe("24h")
  })

  it("getSetting returns default for unset key", () => {
    expect(getSetting("timezone")).toBe("UTC")
  })

  it("isExplicitlySet returns false for defaults", () => {
    expect(isExplicitlySet("timezone")).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// Set / Get
// ---------------------------------------------------------------------------

describe("set and get", () => {
  it("setSetting persists a string value", () => {
    setSetting("timezone", "America/New_York")
    expect(getSetting("timezone")).toBe("America/New_York")
    expect(isExplicitlySet("timezone")).toBe(true)
  })

  it("setSetting persists a boolean value", () => {
    setSetting("verbose", true)
    expect(getSetting("verbose")).toBe(true)
  })

  it("settings persist to disk as valid JSON", () => {
    setSetting("color", "never")
    // Read back via getSetting to verify persistence
    expect(getSetting("color")).toBe("never")
  })

  it("multiple settings persist together", () => {
    setSetting("timezone", "Europe/London")
    setSetting("verbose", true)
    setSetting("color", "always")
    expect(getSetting("timezone")).toBe("Europe/London")
    expect(getSetting("verbose")).toBe(true)
    expect(getSetting("color")).toBe("always")
  })
})

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

describe("validation", () => {
  it("rejects unknown keys", () => {
    expect(() => validateSetting("not.a.key", "value")).toThrow("Unknown setting")
  })

  it("rejects invalid enum values", () => {
    expect(() => validateSetting("color", "banana")).toThrow("must be one of")
  })

  it("accepts valid enum values", () => {
    const result = validateSetting("color", "never")
    expect(result).toEqual({ key: "color", parsed: "never" })
  })

  it("rejects invalid boolean strings", () => {
    expect(() => validateSetting("verbose", "yes")).toThrow('must be "true" or "false"')
  })

  it("parses boolean strings correctly", () => {
    expect(validateSetting("context.auto", "true")).toEqual({ key: "context.auto", parsed: true })
    expect(validateSetting("verbose", "false")).toEqual({ key: "verbose", parsed: false })
  })

  it("rejects invalid timezone", () => {
    expect(() => validateSetting("timezone", "Not/A/Timezone")).toThrow("Invalid timezone")
  })

  it("accepts valid timezone", () => {
    const result = validateSetting("timezone", "America/Chicago")
    expect(result).toEqual({ key: "timezone", parsed: "America/Chicago" })
  })

  it("accepts UTC timezone", () => {
    const result = validateSetting("timezone", "UTC")
    expect(result).toEqual({ key: "timezone", parsed: "UTC" })
  })

  it("accepts valid default_filter values", () => {
    expect(validateSetting("default_filter", "pending")).toEqual({ key: "default_filter", parsed: "pending" })
    expect(validateSetting("default_filter", "today")).toEqual({ key: "default_filter", parsed: "today" })
    expect(validateSetting("default_filter", "all")).toEqual({ key: "default_filter", parsed: "all" })
  })

  it("accepts valid date_format values", () => {
    expect(validateSetting("date_format", "relative")).toEqual({ key: "date_format", parsed: "relative" })
    expect(validateSetting("date_format", "iso")).toEqual({ key: "date_format", parsed: "iso" })
    expect(validateSetting("date_format", "short")).toEqual({ key: "date_format", parsed: "short" })
    expect(validateSetting("date_format", "local")).toEqual({ key: "date_format", parsed: "local" })
  })

  it("standup.since accepts any string", () => {
    const result = validateSetting("standup.since", "8h")
    expect(result).toEqual({ key: "standup.since", parsed: "8h" })
  })
})

// ---------------------------------------------------------------------------
// isValidKey
// ---------------------------------------------------------------------------

describe("isValidKey", () => {
  it("returns true for known keys", () => {
    expect(isValidKey("timezone")).toBe(true)
    expect(isValidKey("context.auto")).toBe(true)
    expect(isValidKey("standup.since")).toBe(true)
  })

  it("returns false for unknown keys", () => {
    expect(isValidKey("nope")).toBe(false)
    expect(isValidKey("")).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// shouldUseColor
// ---------------------------------------------------------------------------

describe("shouldUseColor", () => {
  it('returns false when color setting is "never"', () => {
    setSetting("color", "never")
    expect(shouldUseColor()).toBe(false)
  })

  it('returns true when color setting is "always"', () => {
    setSetting("color", "always")
    expect(shouldUseColor()).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// getDefaults
// ---------------------------------------------------------------------------

describe("getDefaults", () => {
  it("returns all 7 setting keys", () => {
    const defaults = getDefaults()
    const keys = Object.keys(defaults)
    expect(keys).toHaveLength(7)
    expect(keys).toContain("context.auto")
    expect(keys).toContain("timezone")
    expect(keys).toContain("default_filter")
    expect(keys).toContain("date_format")
    expect(keys).toContain("color")
    expect(keys).toContain("verbose")
    expect(keys).toContain("standup.since")
  })
})
