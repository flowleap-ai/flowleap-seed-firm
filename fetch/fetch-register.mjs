#!/usr/bin/env node
/**
 * Fetches the register snapshot of each seed matter through FlowLeap and writes
 * matters/<application>/register/<tool>.json (tool, input, fetchedAt, sha256, body).
 *
 * Usage: node fetch/fetch-register.mjs [<application>...]
 * Needs the FlowLeap CLI with an account that has a plan (decision D6). It stops at the first refused call
 * and writes nothing for that matter. Running it again replaces the snapshots; check/compare.mjs shows what changed.
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { loadSeed } from '../index.mjs'
import { callTool, registerCalls, selectMatters, snapshot } from './flowleap.mjs'

for (const matter of selectMatters(loadSeed(), process.argv.slice(2))) {
  const snapshots = registerCalls(matter).map(({ tool, input }) => snapshot(tool, input, callTool(tool, input)))
  const dir = join(matter.dir, 'register')
  mkdirSync(dir, { recursive: true })
  for (const s of snapshots) writeFileSync(join(dir, `${s.tool}.json`), `${JSON.stringify(s, null, 2)}\n`)
  console.log(`fetch-register: ${matter.application}: ${snapshots.length} snapshot(s) written`)
}
