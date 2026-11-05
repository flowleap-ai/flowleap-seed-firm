/**
 * The FlowLeap calls that make the register snapshot of a seed matter, shared by fetch-register.mjs and compare.mjs.
 * The calls go through the FlowLeap CLI (`flowleap --json tools run`), which reads its own credentials
 * (`flowleap auth login`, or FLOWLEAP_API_KEY for a personal API token). This module never reads or prints a credential.
 */
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { canonicalJson } from '../check/check-seed.mjs'

/**
 * @param {import('../index.mjs').Matter} matter - A seed matter.
 * @returns {{ tool: string, input: Record<string, string> }[]} The FlowLeap tool calls of its register snapshot.
 */
export function registerCalls(matter) {
  const publication = matter.firstPublication
  return [
    { tool: 'search_register', input: { query: `ap=${matter.application}`, range: '1-1' } },
    { tool: 'get_register_biblio', input: { patent_number: publication } },
    { tool: 'get_register_events', input: { patent_number: publication } },
    { tool: 'get_legal_status', input: { patent_number: publication } },
    { tool: 'get_bibliography', input: { patent_number: publication } },
  ]
}

/**
 * Runs one FlowLeap tool and returns its data. On success the CLI unwraps the tool response and prints only
 * its data; on a refused call (no plan, no key, an error of the tool) it exits non-zero and prints
 * `{ ok: false, status, body }`. A refusal throws with the HTTP status and the error code, so a fetch
 * never stores a refusal as data.
 * @param {string} tool - The FlowLeap tool name.
 * @param {Record<string, string>} input - The tool input.
 * @returns {unknown} The data of the tool.
 */
export function callTool(tool, input) {
  const call = `flowleap ${tool} ${JSON.stringify(input)}`
  let output
  try {
    output = execFileSync('flowleap', ['--json', 'tools', 'run', tool, '--input', JSON.stringify(input)], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
  } catch (error) {
    const envelope = error.stdout ? JSON.parse(error.stdout) : null
    if (envelope?.ok === false) throw new Error(`${call}: HTTP ${envelope.status} ${envelope.body?.error?.code ?? ''}`.trim())
    throw new Error(`${call} failed: ${error.message}`)
  }
  const data = JSON.parse(output)
  if (data?.ok === false) throw new Error(`${call}: HTTP ${data.status} ${data.body?.error?.code ?? ''}`.trim())
  return data
}

/**
 * @param {import('../index.mjs').Seed} seed - The seed.
 * @param {string[]} applications - Application numbers from the command line; none means every matter.
 * @returns {import('../index.mjs').Matter[]} The matters to fetch or compare.
 */
export function selectMatters(seed, applications) {
  const unknown = applications.filter(a => !seed.matters.some(m => m.application === a))
  if (unknown.length > 0) throw new Error(`not a seed matter: ${unknown.join(', ')}`)
  return seed.matters.filter(m => applications.length === 0 || applications.includes(m.application))
}

/**
 * @param {string} tool - The FlowLeap tool name.
 * @param {Record<string, string>} input - The tool input.
 * @param {unknown} body - The response body.
 * @returns {import('../index.mjs').RegisterSnapshot} The snapshot as stored in matters/<application>/register/<tool>.json.
 */
export function snapshot(tool, input, body) {
  return {
    tool,
    input,
    fetchedAt: new Date().toISOString(),
    source: 'FlowLeap CLI: flowleap --json tools run',
    sha256: createHash('sha256').update(canonicalJson(body)).digest('hex'),
    body,
  }
}
