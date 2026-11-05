import assert from 'node:assert/strict'
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { delimiter, join } from 'node:path'
import { after, test } from 'node:test'
import { callTool, registerCalls, selectMatters, snapshot } from '../fetch/flowleap.mjs'
import { canonicalJson } from '../check/check-seed.mjs'
import { loadSeed } from '../index.mjs'

const dirs = []
const path = process.env.PATH
after(() => {
  process.env.PATH = path
  dirs.forEach(dir => rmSync(dir, { recursive: true, force: true }))
})

/** Puts a stub `flowleap` on the PATH that prints `output` as JSON and exits with `code`. */
function stubCli(output, code) {
  const dir = mkdtempSync(join(tmpdir(), 'flowleap-stub-'))
  dirs.push(dir)
  const cli = join(dir, 'flowleap')
  writeFileSync(cli, `#!/bin/sh\nprintf '%s' '${JSON.stringify(output)}'\nexit ${code}\n`)
  chmodSync(cli, 0o755)
  process.env.PATH = `${dir}${delimiter}${path}`
}

test('a refused call throws with its status and error code and stores nothing', () => {
  stubCli({ ok: false, status: 402, body: { error: { code: 'subscription_required' } } }, 4)
  assert.throws(() => callTool('get_legal_status', { patent_number: 'EP4189782A2' }), /HTTP 402 subscription_required/)
})

test('a good call returns the data that the CLI prints, and the snapshot hash covers it', () => {
  const body = { docId: 'EP4189782A2', events: [{ code: 'INTG', effectiveDate: '2025-08-29' }] }
  stubCli(body, 0)
  const s = snapshot('get_legal_status', { patent_number: 'EP4189782A2' }, callTool('get_legal_status', { patent_number: 'EP4189782A2' }))
  assert.deepEqual(s.body, body)
  assert.match(s.sha256, /^[0-9a-f]{64}$/)
  assert.equal(canonicalJson(s.body), canonicalJson(body))
})

test('a refusal envelope on a zero exit still throws', () => {
  stubCli({ ok: false, status: 400, body: { error: { code: 'data_keys_required' } } }, 0)
  assert.throws(() => callTool('get_legal_status', { patent_number: 'EP4189782A2' }), /HTTP 400 data_keys_required/)
})

test('a fetch or compare of an application outside the seed is refused', () => {
  assert.throws(() => selectMatters(loadSeed(), ['EP99999999']), /not a seed matter: EP99999999/)
  assert.equal(selectMatters(loadSeed(), []).length, 7)
})

test('each seed matter has five register calls by its application and first publication', () => {
  for (const matter of loadSeed().matters) {
    const calls = registerCalls(matter)
    assert.equal(calls.length, 5)
    assert.equal(calls[0].input.query, `ap=${matter.application}`)
    assert.ok(calls.slice(1).every(c => c.input.patent_number === matter.firstPublication))
  }
})
