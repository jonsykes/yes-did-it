#!/usr/bin/env node

const { run } = require('@oclif/core')

run(process.argv.slice(2), require.resolve('../package.json'))
  .catch((err) => {
    console.error(err.message ?? err)
    process.exit(1)
  })
