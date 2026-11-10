import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { appendFileSync, cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, test } from 'node:test'
import { loadSeed, maySee, responsibleAt, SEED_ROOT, seedCase, visibleMatters } from '../index.mjs'
import { canonicalJson, checkSeed } from '../check/check-seed.mjs'

const seed = loadSeed()
const matter = application => seed.matters.find(m => m.application === application)
const copies = []
after(() => copies.forEach(dir => rmSync(dir, { recursive: true, force: true })))

/** A writable copy of the package, changed by `edit`, then checked. */
function checkCopy(edit) {
  const root = mkdtempSync(join(tmpdir(), 'seed-firm-'))
  copies.push(root)
  cpSync(SEED_ROOT, root, { recursive: true, filter: source => !source.includes('/.git') && !source.includes('/node_modules') })
  edit(root)
  return checkSeed(root).errors
}
const editJson = (root, path, change) => {
  const file = join(root, path)
  writeFileSync(file, `${JSON.stringify(change(JSON.parse(readFileSync(file, 'utf8'))), null, 2)}\n`)
}

test('the committed seed has no errors', () => {
  assert.deepEqual(checkSeed().errors, [])
})

test('a screened attorney does not see the matter of a client the attorney otherwise sees', () => {
  assert.equal(maySee(seed, 'jonas', matter('EP22213933')), false)
  assert.deepEqual(visibleMatters(seed, 'jonas'), ['EP21755382', 'EP24166597'])
})

test('the partner sees every matter and the IT administrator sees none', () => {
  assert.equal(visibleMatters(seed, 'partner').length, seed.matters.length)
  assert.deepEqual(visibleMatters(seed, 'felix'), [])
})

test('after the handover the new attorney sees the matter and is responsible', () => {
  assert.equal(maySee(seed, 'anna', matter('EP23771920'), '2026-10-14'), false)
  assert.equal(maySee(seed, 'anna', matter('EP23771920'), '2026-10-15'), true)
  assert.equal(responsibleAt(seed, matter('EP23771920'), '2026-10-14'), 'lena')
  assert.equal(responsibleAt(seed, matter('EP23771920'), 'fetch'), 'anna')
})

test('a test picks the letter with two dates by its case id', () => {
  const { matter: m, documents } = seedCase(seed, 'two-dates')
  assert.equal(m.application, 'EP20706232')
  assert.equal(documents[0].dateOnDocument, '2026-01-21')
  assert.deepEqual(documents[0].otherDates.map(d => d.date), ['2025-08-29'])
})

test('no seed document has a text layer', () => {
  assert.ok(seed.matters.flatMap(m => m.documents).every(d => d.textLayer === false))
})

test('the check rejects a changed PDF', () => {
  const errors = checkCopy(root => appendFileSync(join(root, 'matters/EP21755382/documents/02.pdf'), '\n'))
  assert.ok(errors.some(e => e.includes('EP21755382 row 2') && e.includes('differs from its recorded sha256')), errors.join('\n'))
})

test('the check rejects a PDF that documents.json does not list', () => {
  const errors = checkCopy(root => writeFileSync(join(root, 'matters/EP21755382/documents/99.pdf'), '%PDF-1.4\n'))
  assert.ok(errors.some(e => e.includes('documents/99.pdf is not in documents.json')), errors.join('\n'))
})

test('the check rejects a matter that every user may see', () => {
  const errors = checkCopy(root => editJson(root, 'firm/groups.json', groups => groups.map(g =>
    g.name === 'matter-ep20706232' ? { ...g, members: seed.users.map(u => ({ user: u.handle })) } : g)))
  assert.ok(errors.some(e => e.includes('EP20706232: no user is outside the wall')), errors.join('\n'))
})

test('the check rejects a seed without a screen inside a client wall', () => {
  const errors = checkCopy(root => editJson(root, 'firm/groups.json', groups => groups.filter(g => g.kind !== 'screen')))
  assert.ok(errors.some(e => e.startsWith('walls: no user is screened')), errors.join('\n'))
})

test('the check rejects an object id that is used twice', () => {
  const errors = checkCopy(root => editJson(root, 'firm/users.json', users => users.map(u =>
    u.handle === 'felix' ? { ...u, objectId: users[0].objectId } : u)))
  assert.ok(errors.some(e => e.includes('is used twice')), errors.join('\n'))
})

test('the check rejects an assistant who may confirm deadlines', () => {
  const errors = checkCopy(root => editJson(root, 'firm/users.json', users => users.map(u =>
    u.handle === 'miriam' ? { ...u, firmRole: 'assistant', mayConfirmDeadlines: true } : u)))
  assert.ok(errors.some(e => e.includes('users.miriam: an assistant may not confirm deadlines')), errors.join('\n'))
})

/** A copy whose matter has one register snapshot of `tool` with `body`, checked. */
function checkWithSnapshot(application, tool, body) {
  return checkCopy(root => {
    const dir = join(root, 'matters', application, 'register')
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, `${tool}.json`), JSON.stringify({
      tool, input: {}, fetchedAt: '2026-11-05T00:00:00Z', source: 'test',
      sha256: createHash('sha256').update(canonicalJson(body)).digest('hex'), body,
    }))
  })
}

test('the check rejects a user with the name of a person in the register data', () => {
  const errors = checkWithSnapshot('EP23755468', 'search_register',
    { docs: [{ applicants: ['Renishaw plc'], representatives: [{ name: 'Weber, Jonas' }], opponents: [] }] })
  assert.ok(errors.some(e => e.includes('user jonas has the name of "Weber, Jonas"')), errors.join('\n'))
})

test('the name check reads every snapshot, plain strings and transliterated names', () => {
  const errors = checkWithSnapshot('EP21755382', 'get_register_biblio', { representatives: ['KRUEGER, Martin'], opponents: [] })
  assert.ok(errors.some(e => e.includes('user partner has the name of "KRUEGER, Martin"')), errors.join('\n'))
})

test('add-documents refuses to re-record a committed PDF that has changed', () => {
  let root
  checkCopy(copy => {
    root = copy
    appendFileSync(join(copy, 'matters/EP21755382/documents/02.pdf'), '\n')
  })
  const downloads = mkdtempSync(join(tmpdir(), 'seed-downloads-'))
  copies.push(downloads)
  assert.throws(() => execFileSync('node', [join(root, 'fetch/add-documents.mjs'), downloads], { stdio: 'pipe' }),
    error => /EP21755382 row 2: .* differs from its recorded sha256/.test(String(error.stderr)))
  assert.ok(checkSeed(root).errors.some(e => e.includes('EP21755382 row 2')), 'the changed PDF still fails the check')
})
