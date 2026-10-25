#!/usr/bin/env node

import { runCli } from '../dist/index.js'

runCli().then(
  code => { process.exitCode = code },
  error => {
    console.error(error instanceof Error ? error.message : 'The Remote command failed.')
    process.exitCode = 1
  },
)
