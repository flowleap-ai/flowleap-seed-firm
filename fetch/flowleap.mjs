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
 * Runs one FlowLeap tool and returns its body. A refused call (no plan, no key, an error of the tool) throws
 * with the HTTP status and the error code, so a fetch never stores a refusal as data.
 * @param {string} tool - The FlowLeap tool name.
 * @param {Record<string, string>} input - The tool input.
 * @returns {unknown} The response body.
 */
export function callTool(tool, input) {
  let output
  try {
    output = execFileSync('flowleap', ['--json', 'tools', 'run', tool, '--input', JSON.stringify(input)], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
  } catch (error) {
    // The CLI exits non-zero on a refused call and still prints its JSON envelope.
    output = error.stdout
    if (!output) throw new Error(`flowleap ${tool} failed: ${error.message}`)
  }
  const envelope = JSON.parse(output)
  if (typeof envelope.ok !== 'boolean' || !('body' in envelope)) throw new Error(`flowleap ${tool}: unexpected CLI output; expected { ok, status, body }`)
  if (!envelope.ok) throw new Error(`flowleap ${tool} ${JSON.stringify(input)}: HTTP ${envelope.status} ${envelope.body?.error?.code ?? ''}`.trim())
  return envelope.body
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
