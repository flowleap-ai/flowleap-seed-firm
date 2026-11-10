#!/usr/bin/env node
/**
 * Checks the seed without network: the PDFs against their recorded hashes, the users, the groups and walls,
 * the matters, the cases and the register snapshots.
 *
 * Usage: node check/check-seed.mjs [--complete]
 * An error exits 1. An open item is a named gap that a person must fill (for example a register document id);
 * it is listed and exits 0, or exits 1 with --complete.
 */
import { createHash } from 'node:crypto'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { loadSeed, maySee, SEED_ROOT } from '../index.mjs'

const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/
const FIRM_ROLES = ['partner', 'attorney', 'formalities', 'assistant', 'administrator']
const APP_ROLES = ['FlowLeap.User', 'FlowLeap.Administrator']
const MAY_BE_RESPONSIBLE = ['partner', 'attorney']
const DOCUMENT_KINDS = ['r71-3-communication', 'art94-3-communication', 'art94-3-annex', 'decision-to-grant',
  'r112-1-loss-of-rights', 'r79-1-notice-of-opposition', 'text-intended-for-grant', 'european-search-report',
  'r69-fee-reminder']
const UNDATED_KINDS = ['text-intended-for-grant']
const REGISTER_TOOLS = ['search_register', 'get_register_biblio', 'get_register_events', 'get_legal_status', 'get_bibliography']

/**
 * @param {unknown} value - Any JSON value.
 * @returns {string} JSON with sorted object keys, so equal values hash equally.
 */
export function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`
  }
  return JSON.stringify(value)
}

const sha256 = data => createHash('sha256').update(data).digest('hex')
const duplicates = values => values.filter((value, i) => values.indexOf(value) !== i)
const TRANSLITERATION = { ä: 'ae', ö: 'oe', ü: 'ue', ß: 'ss' }
const nameTokens = name => name.toLowerCase().replace(/[äöüß]/g, c => TRANSLITERATION[c])
  .normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
  .replace(/\bdr\.|\bprof\.|[,.]/g, ' ').split(/\s+/).filter(Boolean)
const PARTY_KEY = /name|applicant|representative|opponent|inventor|agent|proprietor/i

/**
 * Collects every name in the register snapshots of one matter: each string under a party key
 * (applicants, representatives, opponents, inventors, name ...) at any depth, so the check does not
 * depend on the response fields of one FlowLeap tool.
 * @param {import('../index.mjs').Matter} matter - A matter with register snapshots.
 * @returns {string[]} The names as published.
 */
function registerNames(matter) {
  const names = []
  const walk = (value, partyKey) => {
    if (typeof value === 'string') {
      if (partyKey) names.push(value)
    } else if (Array.isArray(value)) {
      value.forEach(item => walk(item, partyKey))
    } else if (value && typeof value === 'object') {
      for (const [key, child] of Object.entries(value)) walk(child, partyKey || PARTY_KEY.test(key))
    }
  }
  for (const snapshot of Object.values(matter.register)) walk(snapshot.body, false)
  return names
}

/**
 * @param {string} [root] - The package directory.
 * @returns {{ errors: string[], open: string[] }} The errors and the open items.
 */
export function checkSeed(root = SEED_ROOT) {
  const errors = []
  const open = []
  const seed = loadSeed(root)
  const users = new Map(seed.users.map(u => [u.handle, u]))
  const clients = new Map(seed.clients.map(c => [c.id, c]))
  const matters = new Map(seed.matters.map(m => [m.application, m]))

  for (const handle of duplicates(seed.users.map(u => u.handle))) errors.push(`users: handle "${handle}" is not unique`)
  for (const id of duplicates([seed.firm.tenantId, ...seed.users.map(u => u.objectId), ...seed.groups.map(g => g.objectId)])) {
    errors.push(`object id ${id} is used twice`)
  }
  if (!GUID.test(seed.firm.tenantId)) errors.push('firm: tenantId is not a version-4 GUID')
  for (const user of seed.users) {
    if (!GUID.test(user.objectId)) errors.push(`users.${user.handle}: objectId is not a version-4 GUID`)
    if (!FIRM_ROLES.includes(user.firmRole)) errors.push(`users.${user.handle}: unknown firmRole "${user.firmRole}"`)
    if (!APP_ROLES.includes(user.appRole)) errors.push(`users.${user.handle}: unknown appRole "${user.appRole}"`)
    if (!user.signIn.endsWith(`@${seed.firm.domain}`)) errors.push(`users.${user.handle}: signIn is not in ${seed.firm.domain}`)
    if (user.firmRole === 'assistant' && user.mayConfirmDeadlines) errors.push(`users.${user.handle}: an assistant may not confirm deadlines (decision D5)`)
  }

  for (const name of duplicates(seed.groups.map(g => g.name))) errors.push(`groups: name "${name}" is not unique`)
  for (const group of seed.groups) {
    if (!GUID.test(group.objectId)) errors.push(`groups.${group.name}: objectId is not a version-4 GUID`)
    const expected = group.kind === 'client' ? `client-${group.client}` : `${group.kind}-${String(group.matter).toLowerCase()}`
    if (group.name !== expected) errors.push(`groups.${group.name}: a ${group.kind} group must be named ${expected}`)
    if (group.kind === 'client' && !clients.has(group.client)) errors.push(`groups.${group.name}: unknown client ${group.client}`)
    if (group.kind !== 'client' && !matters.has(group.matter)) errors.push(`groups.${group.name}: unknown matter ${group.matter}`)
    for (const member of group.members) {
      if (!users.has(member.user)) errors.push(`groups.${group.name}: unknown member ${member.user}`)
      if (member.from !== undefined && !ISO_DATE.test(member.from)) errors.push(`groups.${group.name}: ${member.user}.from is not an ISO date`)
    }
  }
  for (const client of seed.clients) {
    if (seed.groups.filter(g => g.kind === 'client' && g.client === client.id).length !== 1) errors.push(`clients.${client.id}: needs exactly one client group`)
  }

  const clocks = Object.keys(seed.clocks.clocks)
  if (!clocks.includes(seed.clocks.default)) errors.push(`clocks: default "${seed.clocks.default}" is not a clock`)
  const fileNumbers = seed.matters.map(m => m.fileNumber)
  for (const number of duplicates(fileNumbers)) errors.push(`matters: file number ${number} is not unique`)
  const rows = []
  for (const matter of seed.matters) {
    const where = `matters/${matter.application}`
    if (matter.registerUrl !== `https://register.epo.org/application?number=${matter.application}&lng=en`) errors.push(`${where}: registerUrl is not the register page of ${matter.application}`)
    if (!clients.has(matter.client)) errors.push(`${where}: unknown client ${matter.client}`)
    if (seed.groups.filter(g => g.kind === 'matter' && g.matter === matter.application).length !== 1) errors.push(`${where}: needs exactly one matter group`)
    for (const r of [...matter.responsible.map(r => r.user), ...matter.coAttorneys]) {
      if (!MAY_BE_RESPONSIBLE.includes(users.get(r)?.firmRole)) errors.push(`${where}: ${r} is not a partner or attorney`)
    }
    for (const clock of clocks) {
      const date = seed.clocks.clocks[clock]
      const responsible = matter.responsible.filter(r => r.from === undefined || r.from <= date).at(-1)?.user
      if (responsible && !maySee(seed, responsible, matter, date)) errors.push(`${where}: the responsible attorney ${responsible} cannot see the matter at clock ${clock}`)
      if (seed.users.every(u => maySee(seed, u.handle, matter, date))) errors.push(`${where}: no user is outside the wall at clock ${clock}`)
    }

    const listed = new Set()
    for (const document of matter.documents) {
      const at = `${where} row ${document.row}`
      rows.push(document.row)
      listed.add(document.file)
      if (!DOCUMENT_KINDS.includes(document.kind)) errors.push(`${at}: unknown kind "${document.kind}"`)
      if (!ISO_DATE.test(document.registerListDate)) errors.push(`${at}: registerListDate is not an ISO date`)
      if (document.dateOnDocument === null ? !UNDATED_KINDS.includes(document.kind) : !ISO_DATE.test(document.dateOnDocument)) {
        errors.push(`${at}: a ${document.kind} needs dateOnDocument as an ISO date`)
      }
      for (const other of document.otherDates) if (!ISO_DATE.test(other.date)) errors.push(`${at}: otherDates has "${other.date}"`)
      if (!existsSync(document.path)) {
        errors.push(`${at}: ${document.file} is missing`)
        continue
      }
      const bytes = readFileSync(document.path)
      if (document.sha256 === undefined) errors.push(`${at}: no measured fields; run fetch/add-documents.mjs`)
      else if (sha256(bytes) !== document.sha256 || bytes.length !== document.bytes) errors.push(`${at}: ${document.file} differs from its recorded sha256 and size`)
      if (document.registerDocumentId === null) open.push(`${at}: registerDocumentId (copy it from the register "All documents" page)`)
    }
    const documentsDir = join(matter.dir, 'documents')
    for (const file of existsSync(documentsDir) ? readdirSync(documentsDir) : []) {
      if (!listed.has(`documents/${file}`)) errors.push(`${where}: documents/${file} is not in documents.json`)
    }

    const tools = Object.keys(matter.register)
    if (tools.length === 0) open.push(`${where}: no register snapshot; run fetch/fetch-register.mjs (needs a FlowLeap token, decision D6)`)
    for (const tool of tools) {
      const snapshot = matter.register[tool]
      if (!REGISTER_TOOLS.includes(tool) || snapshot.tool !== tool) errors.push(`${where}/register/${tool}.json: unknown or mismatched tool`)
      if (!ISO_DATE.test(String(snapshot.fetchedAt).slice(0, 10))) errors.push(`${where}/register/${tool}.json: no fetchedAt`)
      if (sha256(canonicalJson(snapshot.body)) !== snapshot.sha256) errors.push(`${where}/register/${tool}.json: body differs from its sha256`)
    }
    for (const name of registerNames(matter)) {
      const published = new Set(nameTokens(name))
      for (const user of seed.users) {
        if (nameTokens(user.name).every(token => published.has(token))) errors.push(`${where}: user ${user.handle} has the name of "${name}" from the register`)
      }
    }
  }
  for (const row of duplicates(rows)) errors.push(`documents: row ${row} is used twice`)

  const screened = seed.groups.filter(g => g.kind === 'screen').some(screen => {
    const matter = matters.get(screen.matter)
    const clientGroup = matter && seed.groups.find(g => g.kind === 'client' && g.client === matter.client)
    return clientGroup && screen.members.some(m => clientGroup.members.some(c => c.user === m.user))
  })
  if (!screened) errors.push('walls: no user is screened from a matter of a client that the user otherwise sees (#294)')

  for (const seedCase of seed.cases) {
    const matter = matters.get(seedCase.matter)
    if (!matter) {
      errors.push(`cases.${seedCase.id}: unknown matter ${seedCase.matter}`)
      continue
    }
    for (const row of seedCase.rows ?? []) {
      if (!matter.documents.some(d => d.row === row)) errors.push(`cases.${seedCase.id}: ${matter.application} has no row ${row}`)
    }
    for (const user of seedCase.users ?? []) if (!users.has(user)) errors.push(`cases.${seedCase.id}: unknown user ${user}`)
  }
  for (const id of duplicates(seed.cases.map(c => c.id))) errors.push(`cases: id "${id}" is not unique`)
  return { errors, open }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const complete = process.argv.includes('--complete')
  const { errors, open } = checkSeed()
  for (const error of errors) console.error(`error: ${error}`)
  for (const item of open) console.log(`open: ${item}`)
  console.log(`check-seed: ${errors.length} error(s), ${open.length} open item(s)`)
  process.exit(errors.length > 0 || (complete && open.length > 0) ? 1 : 0)
}
