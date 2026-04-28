import { defineConfig } from "vitest/config"

export default defineConfig({
  test: {
    include: ["src/test/**/*.test.ts"],
    timeout: 30000, // CLI commands involve network calls
    pool: "forks",  // CJS compatibility
    globalSetup: ["src/test/global-setup.ts"],
  },
})
