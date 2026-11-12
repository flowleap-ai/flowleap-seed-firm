#!/usr/bin/env node
/**
 * Builds the text-layer test fixtures of the Form 2001 letters (text-fixtures/NN.flowleap-ocr-text.pdf) from their text files
 * (NN.flowleap-ocr-text.txt), and writes their measured fields (sha256, bytes, pages) into the letter's `textFixture` in
 * documents.json. Each `=== page N of M: <register file> page K ===` line starts one PDF page, so the PDF keeps the pages of the
 * register copies. The PDF is plain Helvetica text, one line per text line, with no date in it, so the same text gives the
 * same bytes. Its Producer and Subject say that FlowLeap made it.
 *
 *   node fetch/make-text-fixtures.mjs          build every fixture and update documents.json
 *   node fetch/make-text-fixtures.mjs --check  exit 1 when a fixture differs from what its text gives
 */
import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { loadSeed } from '../index.mjs'

/** The words that each fixture carries in its PDF metadata. */
export const FIXTURE_MARK = 'FlowLeap test fixture: text from OCR of the public EP Register copy, not a Mailbox file'

const PAGE = { width: 595, height: 842, margin: 48 }
const MAX_CHARS = 100
// The characters of WinAnsiEncoding above 0x7F that are not Latin-1 (PDF 32000-1, Annex D).
const WIN_ANSI = new Map([['€', 0x80], ['‚', 0x82], ['„', 0x84], ['…', 0x85], ['‘', 0x91], ['’', 0x92], ['“', 0x93], ['”', 0x94], ['•', 0x95], ['–', 0x96], ['—', 0x97], ['™', 0x99], ['‹', 0x8b], ['›', 0x9b]])

/**
 * The pages of a fixture text file.
 * @param {string} text - The file.
 * @returns {string[][]} The lines of each page.
 */
export function pagesOf(text) {
  const pages = []
  for (const line of text.split('\n')) {
    if (/^=== page \d+ of \d+: .+ ===$/.test(line)) pages.push([])
    else if (pages.length === 0) throw new Error('the text must start with a "=== page 1 of N: ... ===" line')
    else pages.at(-1).push(line)
  }
  return pages.map(lines => {
    while (lines.at(-1) === '') lines.pop()
    return lines.flatMap(wrap)
  })
}

/** A line cut at word ends into lines of at most MAX_CHARS characters. */
function wrap(line) {
  if (line.length <= MAX_CHARS) return [line]
  const out = []
  let rest = line
  while (rest.length > MAX_CHARS) {
    const cut = rest.lastIndexOf(' ', MAX_CHARS)
    const at = cut > 0 ? cut : MAX_CHARS
    out.push(rest.slice(0, at))
    rest = rest.slice(at).trimStart()
  }
  return [...out, rest]
}

/** A string in a PDF literal, in WinAnsiEncoding. */
function literal(text) {
  const bytes = []
  for (const ch of text) {
    const code = ch.codePointAt(0)
    const byte = WIN_ANSI.get(ch) ?? (code < 0x100 ? code : null)
    if (byte === null) throw new Error(`"${ch}" (U+${code.toString(16)}) is not in WinAnsiEncoding; replace it in the text file`)
    if (byte === 0x28 || byte === 0x29 || byte === 0x5c) bytes.push(0x5c)
    bytes.push(byte)
  }
  return `(${Buffer.from(bytes).toString('latin1')})`
}

/**
 * The PDF of the pages.
 * @param {string[][]} pages - The lines of each page.
 * @param {{ title: string }} info - The title of the document.
 * @returns {Buffer} The PDF.
 */
export function pdfOf(pages, { title }) {
  const objects = []
  const add = body => objects.push(body) && objects.length
  const catalog = add('')
  const tree = add('')
  const font = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>')
  const kids = []
  for (const lines of pages) {
    const room = PAGE.height - 2 * PAGE.margin
    const leading = Math.min(12, room / Math.max(lines.length, 1))
    const size = Math.min(9.5, leading - 1.5)
    const ops = lines.map((line, i) => `BT /F1 ${size.toFixed(2)} Tf ${PAGE.margin} ${(PAGE.height - PAGE.margin - (i + 1) * leading).toFixed(2)} Td ${literal(line)} Tj ET`).join('\n')
    const content = add(`<< /Length ${Buffer.byteLength(ops, 'latin1')} >>\nstream\n${ops}\nendstream`)
    kids.push(add(`<< /Type /Page /Parent ${tree} 0 R /MediaBox [0 0 ${PAGE.width} ${PAGE.height}] /Resources << /Font << /F1 ${font} 0 R >> >> /Contents ${content} 0 R >>`))
  }
  objects[catalog - 1] = `<< /Type /Catalog /Pages ${tree} 0 R >>`
  objects[tree - 1] = `<< /Type /Pages /Kids [${kids.map(k => `${k} 0 R`).join(' ')}] /Count ${kids.length} >>`
  const meta = add(`<< /Title ${literal(title)} /Subject ${literal(FIXTURE_MARK)} /Producer ${literal(FIXTURE_MARK)} /Creator (flowleap-seed-firm fetch/make-text-fixtures.mjs) >>`)
  let out = '%PDF-1.4\n%\xe2\xe3\xcf\xd3\n'
  const offsets = []
  objects.forEach((body, i) => {
    offsets.push(Buffer.byteLength(out, 'latin1'))
    out += `${i + 1} 0 obj\n${body}\nendobj\n`
  })
  const xref = Buffer.byteLength(out, 'latin1')
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map(o => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}`
  out += `trailer\n<< /Size ${objects.length + 1} /Root ${catalog} 0 R /Info ${meta} 0 R >>\nstartxref\n${xref}\n%%EOF\n`
  return Buffer.from(out, 'latin1')
}

/**
 * Builds every fixture, or with `check` only compares it with its text.
 * @param {{ check: boolean }} options
 * @returns {number} The number of fixtures that differ (always 0 when not checking).
 */
export function makeTextFixtures({ check }) {
  const sha256 = data => createHash('sha256').update(data).digest('hex')
  let differs = 0
  for (const matter of loadSeed().matters) {
    const file = join(matter.dir, 'documents.json')
    const documents = JSON.parse(readFileSync(file, 'utf8'))
    let changed = false
    for (const document of documents) {
      const fixture = document.textFixture
      if (fixture === undefined) continue
      const pages = pagesOf(readFileSync(join(matter.dir, fixture.text), 'utf8'))
      const pdf = pdfOf(pages, { title: `${matter.application} row ${document.row}: ${document.form} (${FIXTURE_MARK})` })
      const measured = { sha256: sha256(pdf), bytes: pdf.length, pages: pages.length }
      const same = fixture.sha256 === measured.sha256 && fixture.bytes === measured.bytes && fixture.pages === measured.pages
      if (check) {
        if (!same) { differs += 1; console.error(`${matter.application} row ${document.row}: ${fixture.file} differs from its text; run fetch/make-text-fixtures.mjs`) }
        continue
      }
      writeFileSync(join(matter.dir, fixture.file), pdf)
      Object.assign(fixture, measured)
      changed ||= !same
      console.log(`${matter.application} row ${document.row}: ${fixture.file}, ${pages.length} pages, ${pdf.length} bytes`)
    }
    if (changed) writeFileSync(file, `${JSON.stringify(documents, null, 2)}\n`)
  }
  return differs
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href && makeTextFixtures({ check: process.argv.includes('--check') }) > 0) process.exit(1)
