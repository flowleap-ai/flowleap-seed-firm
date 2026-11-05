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
import { callTool, registerCalls, snapshot } from './flowleap.mjs'

const seed = loadSeed()
const wanted = process.argv.slice(2)
const unknown = wanted.filter(a => !seed.matters.some(m => m.application === a))
if (unknown.length > 0) throw new Error(`not a seed matter: ${unknown.join(', ')}`)

for (const matter of seed.matters.filter(m => wanted.length === 0 || wanted.includes(m.application))) {
  const snapshots = registerCalls(matter).map(({ tool, input }) => snapshot(tool, input, callTool(tool, input)))
  const dir = join(matter.dir, 'register')
  mkdirSync(dir, { recursive: true })
  for (const s of snapshots) writeFileSync(join(dir, `${s.tool}.json`), `${JSON.stringify(s, null, 2)}\n`)
  console.log(`fetch-register: ${matter.application}: ${snapshots.length} snapshot(s) written`)
}
