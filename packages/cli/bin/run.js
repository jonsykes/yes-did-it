#!/usr/bin/env node

const { run, Config } = require('@oclif/core')

const argv = process.argv.slice(2)
const root = require.resolve('../package.json')

;(async () => {
  // `ydi --agent describe` / `ydi <cmd> --agent describe` is an out-of-band
  // schema introspection mode. Intercept before oclif dispatches so the
  // literal `describe` token doesn't get parsed as a positional arg.
  if (argv.includes('--agent') && argv.includes('describe')) {
    const config = await Config.load(root)
    const { detectDescribe, runDescribe } = require('../dist/lib/describe')
    const { commandId, describe } = detectDescribe(argv, config.commandIDs)
    if (describe) {
      const out = await runDescribe(config, commandId)
      process.stdout.write(out + '\n')
      process.exit(0)
    }
  }

  try {
    await run(argv, root)
  } catch (err) {
    // Preserve oclif exit codes (e.g. semantic exit codes from --agent error
    // envelopes like NOT_FOUND=3, PERMISSION_DENIED=4). Fall back to 1 for
    // unstructured errors.
    const code = err?.oclif?.exit
    if (typeof code === 'number') {
      process.exit(code)
    }
    console.error(err.message ?? err)
    process.exit(1)
  }
})()
