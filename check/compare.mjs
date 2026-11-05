#!/usr/bin/env node
/**
 * Fetches each register snapshot again through FlowLeap and fails on any difference from the stored body.
 * It names the matter, the tool and the JSON path of each difference. It writes nothing.
 *
 * Usage: node check/compare.mjs [<application>...]
 * Needs the FlowLeap CLI with an account that has a plan (decision D6).
 */
import { loadSeed } from '../index.mjs'
import { callTool, registerCalls, selectMatters } from '../fetch/flowleap.mjs'
import { canonicalJson } from './check-seed.mjs'

/**
 * @param {unknown} stored - The stored value.
 * @param {unknown} fresh - The fetched value.
 * @param {string} path - The JSON path of the two values.
 * @returns {string[]} One line per difference.
 */
function differences(stored, fresh, path) {
  const isObject = v => v !== null && typeof v === 'object'
  if (!isObject(stored) || !isObject(fresh) || Array.isArray(stored) !== Array.isArray(fresh)) {
    return canonicalJson(stored) === canonicalJson(fresh) ? [] : [`${path}: ${canonicalJson(stored)} -> ${canonicalJson(fresh)}`]
  }
  const keys = new Set([...Object.keys(stored), ...Object.keys(fresh)])
  return [...keys].flatMap(key => differences(stored[key], fresh[key], Array.isArray(stored) ? `${path}[${key}]` : `${path}.${key}`))
}

let found = 0
for (const matter of selectMatters(loadSeed(), process.argv.slice(2))) {
  for (const { tool, input } of registerCalls(matter)) {
    const stored = matter.register[tool]
    if (!stored) {
      console.error(`${matter.application} ${tool}: no stored snapshot; run fetch/fetch-register.mjs`)
      found++
      continue
    }
    const lines = differences(stored.body, callTool(tool, input), 'body')
    for (const line of lines) console.error(`${matter.application} ${tool} (stored ${stored.fetchedAt}): ${line}`)
    found += lines.length
  }
}
console.log(`compare: ${found} difference(s)`)
process.exit(found > 0 ? 1 : 0)
