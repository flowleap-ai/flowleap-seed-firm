#!/usr/bin/env node
/**
 * Copies the PDFs that a person downloaded from the European Patent Register into the package, byte for byte,
 * and writes the measured fields of each documents.json entry: sha256, bytes, pages and textLayer.
 *
 * Usage: node fetch/add-documents.mjs <downloads-dir>
 * The downloads directory holds <application>/<NN>.pdf, where NN is the row of the entry in documents.json.
 * A person writes the read fields of each entry (kind, dates, form, reference) before the run.
 * Running it again changes nothing. It refuses to replace a committed PDF that has other bytes.
 * Needs pdfinfo and pdffonts (poppler).
 */
import { createHash } from 'node:crypto'
import { constants, copyFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'
import { loadSeed, SEED_ROOT } from '../index.mjs'

const downloads = process.argv[2]
if (!downloads) {
  console.error('usage: node fetch/add-documents.mjs <downloads-dir>')
  process.exit(2)
}

const poppler = (tool, file) => {
  try {
    return execFileSync(tool, [file], { encoding: 'utf8' })
  } catch (error) {
    throw new Error(`${tool} failed on ${file} (is poppler installed?): ${error.message}`)
  }
}

const fileSha256 = file => createHash('sha256').update(readFileSync(file)).digest('hex')

/**
 * @param {string} file - A PDF.
 * @returns {{ sha256: string, bytes: number, pages: number, textLayer: boolean }} The measured fields.
 */
function measure(file) {
  const bytes = readFileSync(file)
  const pages = Number(/^Pages:\s+(\d+)$/m.exec(poppler('pdfinfo', file))?.[1])
  if (!Number.isInteger(pages) || pages < 1) throw new Error(`pdfinfo gave no page count for ${file}`)
  // pdffonts prints two header lines and then one line per font; no font means no text layer.
  const fonts = poppler('pdffonts', file).trimEnd().split('\n').length - 2
  return { sha256: createHash('sha256').update(bytes).digest('hex'), bytes: bytes.length, pages, textLayer: fonts > 0 }
}

const seed = loadSeed(SEED_ROOT)
let copied = 0
for (const matter of seed.matters) {
  const entries = JSON.parse(readFileSync(join(matter.dir, 'documents.json'), 'utf8'))
  for (const entry of entries) {
    const source = join(downloads, matter.application, `${String(entry.row).padStart(2, '0')}.pdf`)
    const target = join(matter.dir, entry.file)
    const at = `${matter.application} row ${entry.row}`
    if (!existsSync(target)) {
      if (!existsSync(source)) throw new Error(`${at}: neither ${target} nor ${source} exists`)
      copyFileSync(source, target, constants.COPYFILE_EXCL)
      copied++
    } else if (entry.sha256 !== undefined && fileSha256(target) !== entry.sha256) {
      throw new Error(`${at}: ${target} differs from its recorded sha256; the package never re-records a changed document`)
    } else if (existsSync(source) && fileSha256(source) !== fileSha256(target)) {
      throw new Error(`${at}: ${source} differs from the committed ${target}; the package never replaces a document`)
    }
    Object.assign(entry, measure(target))
  }
  writeFileSync(join(matter.dir, 'documents.json'), `${JSON.stringify(entries, null, 2)}\n`)
}
console.log(`add-documents: ${copied} PDF(s) copied; measured fields written for ${seed.matters.length} matters`)
