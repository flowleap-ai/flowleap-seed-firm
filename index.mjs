/**
 * Reads the seed firm from the files of this package and answers who may see which matter.
 * No network and no dependencies, so every test runner and verify skill can import it.
 * @module flowleap-seed-firm
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

/** The directory of this package. */
export const SEED_ROOT = dirname(fileURLToPath(import.meta.url))

/**
 * @typedef {'partner' | 'attorney' | 'formalities' | 'assistant' | 'administrator'} FirmRole
 * @typedef {{ handle: string, name: string, firmRole: FirmRole, appRole: 'FlowLeap.User' | 'FlowLeap.Administrator',
 *   objectId: string, signIn: string, mayConfirmDeadlines: boolean }} User
 * @typedef {{ user: string, from?: string }} Membership  A membership counts from `from` (ISO date) on, or always.
 * @typedef {{ name: string, objectId: string, members: Membership[] } & (
 *   { kind: 'client', client: string } | { kind: 'matter', matter: string } | { kind: 'screen', matter: string, reason: string })} Group
 * @typedef {{ id: string, publishedNames: string[], aiUse: 'allowed' | 'local-model-only' | 'not-allowed' | null, note: string }} Client
 * @typedef {{ date: string, where: string }} OtherDate
 * @typedef {{ row: number, file: string, path: string, issuer: 'EPO', kind: string, language: 'de' | 'en' | 'fr',
 *   registerDocumentId: string | null, registerListDate: string, dateOnDocument: string | null, otherDates: OtherDate[],
 *   form: string | null, formCode: string | null, reference: string | null, applicationNumberPrinted: string | null,
 *   readBy: string, downloadedBy: string, downloadedAt: string,
 *   sha256?: string, bytes?: number, pages?: number, textLayer?: boolean }} SeedDocument
 *   The measured fields (sha256, bytes, pages, textLayer) are written by fetch/add-documents.mjs.
 * @typedef {{ tool: string, input: Record<string, unknown>, fetchedAt: string, source: string, sha256: string, body: unknown }} RegisterSnapshot
 * @typedef {{ id: string, application: string, firstPublication: string, registerUrl: string, title: string, client: string,
 *   fileNumber: string, type: 'prosecution' | 'opposition', language: 'de' | 'en' | 'fr', languageSource: string,
 *   responsible: Membership[], coAttorneys: string[], dir: string,
 *   documents: SeedDocument[], register: Record<string, RegisterSnapshot> }} Matter
 * @typedef {{ id: string, kind: 'deadline' | 'document' | 'sharing', matter: string, rows?: number[], users?: string[],
 *   date?: string, summary: string }} SeedCase
 * @typedef {{ root: string, firm: { name: string, note: string, tenantId: string, domain: string },
 *   users: User[], groups: Group[], clients: Client[], clocks: { default: string, clocks: Record<string, string> },
 *   matters: Matter[], cases: SeedCase[] }} Seed
 */

const readJson = path => JSON.parse(readFileSync(path, 'utf8'))

/**
 * Reads the whole seed. It checks nothing; `check/check-seed.mjs` does.
 * @param {string} [root] - The package directory; a test passes a modified copy.
 * @returns {Seed} The seed firm.
 */
export function loadSeed(root = SEED_ROOT) {
  const firmFile = name => readJson(join(root, 'firm', name))
  const matters = readdirSync(join(root, 'matters')).filter(name => /^EP\d{8}$/.test(name)).sort().map(application => {
    const dir = join(root, 'matters', application)
    const registerDir = join(dir, 'register')
    const register = existsSync(registerDir)
      ? Object.fromEntries(readdirSync(registerDir).filter(name => name.endsWith('.json')).sort()
        .map(name => [name.slice(0, -'.json'.length), readJson(join(registerDir, name))]))
      : {}
    const documents = readJson(join(dir, 'documents.json')).map(document => ({ ...document, path: join(dir, document.file) }))
    return { ...readJson(join(dir, 'matter.json')), dir, documents, register }
  })
  return {
    root,
    firm: firmFile('firm.json'),
    users: firmFile('users.json'),
    groups: firmFile('groups.json'),
    clients: firmFile('clients.json'),
    clocks: firmFile('clocks.json'),
    matters,
    cases: readJson(join(root, 'cases.json')),
  }
}

/**
 * Resolves a clock name or an ISO date to an ISO date.
 * @param {Seed} seed - The seed.
 * @param {string} [clock] - A name from firm/clocks.json, an ISO date, or nothing for the default clock.
 * @returns {string} The ISO date.
 */
export function clockDate(seed, clock = seed.clocks.default) {
  if (/^\d{4}-\d{2}-\d{2}$/.test(clock)) return clock
  const date = seed.clocks.clocks[clock]
  if (!date) throw new Error(`unknown seed clock "${clock}"; known: ${Object.keys(seed.clocks.clocks).join(', ')}`)
  return date
}

const isMember = (group, handle, date) => group.members.some(m => m.user === handle && (m.from === undefined || m.from <= date))

/**
 * The wall of design section 4.4 as this seed reads it: a user sees a matter when the user is in its client group
 * or its matter team, and is not in its screen. A screen beats a membership. An app role gives no access.
 * @param {Seed} seed - The seed.
 * @param {string} handle - A user handle.
 * @param {Matter} matter - A matter of the seed.
 * @param {string} [clock] - A clock name or an ISO date; memberships with a later `from` do not count.
 * @returns {boolean} Whether the user may see the matter at that date.
 */
export function maySee(seed, handle, matter, clock) {
  const date = clockDate(seed, clock)
  const groupsOf = (kind, key, value) => seed.groups.filter(g => g.kind === kind && g[key] === value)
  if (groupsOf('screen', 'matter', matter.application).some(g => isMember(g, handle, date))) return false
  return [...groupsOf('client', 'client', matter.client), ...groupsOf('matter', 'matter', matter.application)]
    .some(g => isMember(g, handle, date))
}

/**
 * @param {Seed} seed - The seed.
 * @param {string} handle - A user handle.
 * @param {string} [clock] - A clock name or an ISO date.
 * @returns {string[]} The application numbers of the matters that the user may see.
 */
export function visibleMatters(seed, handle, clock) {
  return seed.matters.filter(matter => maySee(seed, handle, matter, clock)).map(matter => matter.application)
}

/**
 * @param {Seed} seed - The seed.
 * @param {Matter} matter - A matter of the seed.
 * @param {string} [clock] - A clock name or an ISO date.
 * @returns {string} The handle of the responsible attorney at that date.
 */
export function responsibleAt(seed, matter, clock) {
  const date = clockDate(seed, clock)
  const current = matter.responsible.filter(r => r.from === undefined || r.from <= date).at(-1)
  if (!current) throw new Error(`${matter.application}: no responsible attorney at ${date}`)
  return current.user
}

/**
 * @param {Seed} seed - The seed.
 * @param {string} id - A case id from cases.json, for example "two-dates".
 * @returns {{ seedCase: SeedCase, matter: Matter, documents: SeedDocument[] }} The case with its matter and documents.
 */
export function seedCase(seed, id) {
  const found = seed.cases.find(c => c.id === id)
  if (!found) throw new Error(`unknown seed case "${id}"`)
  const matter = seed.matters.find(m => m.application === found.matter)
  if (!matter) throw new Error(`seed case "${id}" names the unknown matter ${found.matter}`)
  const documents = (found.rows ?? []).map(row => {
    const document = matter.documents.find(d => d.row === row)
    if (!document) throw new Error(`seed case "${id}" names row ${row}, which ${matter.application} does not have`)
    return document
  })
  return { seedCase: found, matter, documents }
}
