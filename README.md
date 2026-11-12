# flowleap-seed-firm

The shared seed firm of FlowLeap Patent AI. Every test, verify run, design screenshot and demo uses this one firm ([flowleap-harness#294](https://github.com/flowleap-ai/flowleap-harness/issues/294)). The design and the founder's decisions D1 to D7 are in [the proposal](https://github.com/flowleap-ai/flowleap-harness/blob/claude/seed-firm-294-cdc5ec/flowleap/docs/2026-11-05-seed-firm-proposal.md) (flowleap-harness PR 322).

## What is real and what is fictional

- **Real:** the seven matters are public EP applications. Their EPO letters are the PDFs of the European Patent Register, byte for byte, and their register data comes from FlowLeap (`register/`, written by `fetch/fetch-register.mjs`). Names of applicants, representatives, opponents and EPO staff stay exactly as published.
- **Fictional:** the firm, its eight users, their Entra object ids, the groups and walls, the firm file numbers (`SF-...`), the responsible attorneys, the client AI rules, the handover and the other sharing cases. No user has the name of a person in the register data of a seed matter; `check/check-seed.mjs` enforces this once the register snapshots exist.

The applicants are not clients of any real firm through this package. The client relation is part of the fiction.

## Use it

Pin the package by commit, as flowleap-os pins `flowleap-deadlines`:

```json
"devDependencies": { "flowleap-seed-firm": "github:flowleap-ai/flowleap-seed-firm#<commit>" }
```

```js
import { loadSeed, maySee, visibleMatters, responsibleAt, seedCase } from 'flowleap-seed-firm'

const seed = loadSeed()
const { matter, documents } = seedCase(seed, 'two-dates')  // pick a case by id, never by path
documents[0].path                                           // the PDF on disk
visibleMatters(seed, 'jonas')                               // ['EP21755382', 'EP24166597']
maySee(seed, 'anna', matter, 'closure')                     // a clock name or an ISO date
```

A test never defines its own matter: it picks one from `cases.json` or `seed.matters`.

## The wall

A user may see a matter when the user is in its client group (`client-<id>`) or its matter team (`matter-<application>`), and is not in its screen (`screen-<application>`). A screen beats a membership. An app role gives no access: `felix` (`FlowLeap.Administrator`) sees no matter. A membership with `from` counts from that date, so the handover of `EP23771920` to `anna` shows from 2026-10-15. `maySee` is the one implementation of this rule; consumers use it, so every repository reads the wall the same way.

## Layout

| Path | What it holds |
|---|---|
| `firm/firm.json` | The fictional tenant id and domain (`seed-firm.test`) |
| `firm/users.json` | Eight users: handle, name, firm role, app role, Entra object id, sign-in, whether the user may confirm a deadline. The assistant has the firm role `formalities` without the confirm right until the design `Role` union has `assistant` (decision D5) |
| `firm/groups.json` | The client groups, matter teams and the screen, with Entra object ids and members; these are the walls |
| `firm/clients.json` | The three clients, their names as published, and their AI rules (decision D7) |
| `firm/clocks.json` | The named clocks: `fetch` (2026-11-05, default), `closure` (2025-12-22), `after-closure` (2026-01-05) |
| `cases.json` | The named cases: deadlines, documents and the sharing cases S1 to S5 |
| `matters/<application>/matter.json` | The firm-side fields of a matter and its register URL |
| `matters/<application>/documents.json` | One entry per PDF: what a person read from the page, and what `add-documents.mjs` measured |
| `matters/<application>/documents/<NN>.pdf` | The register PDF; NN is the row of the download list |
| `matters/<application>/text-fixtures/<NN>.flowleap-ocr-text.{txt,pdf}` | A test fixture that FlowLeap made, not a register copy: the text of letter NN by OCR, and the PDF with a text layer that `fetch/make-text-fixtures.mjs` writes from it (see [Text fixtures](#text-fixtures-made-by-flowleap)) |
| `matters/<application>/register/<tool>.json` | The FlowLeap response, its input, fetch time, source and SHA-256: `get_register_biblio` and `get_bibliography` of each matter |

## The documents

20 EPO documents. Rows 1 to 19 are the download list of the proposal; the founder downloaded them on 2026-11-05 from each matter's "All documents" page. Rows 20 and 21 of `EP24166597` (the European search report and the Rule 69 reminder to pay the designation and examination fees) came on 2026-11-10 from the same page, with "Selected documents", for the MyEPO double of flowleap-harness; the founder passed the register bot check. Row 12 (a WIPO copy of the PCT priority document) is not in the package: the applicant wrote it, and the EPO letters already cover its case (decision D3).

What the PDFs show:

- **No PDF has a text layer.** Each register copy is a set of page images in an iText wrapper; `pdffonts` lists no font. A reader that needs a text layer finds nothing in any seed letter.
- **Nearly every EPO form has two dates.** The footer prints a date beside the form number, for example `EPA Form 2004C 10.24AUWF (17.06.2025)` on a letter dated 20.06.2025. Decisions to grant also print "zur Poststelle am". Rows 7, 8, 11 and 17 have no footer date.
- **German letters say "EPA Form", "Datum", "Zeichen" and "Anmeldung Nr."**; English letters say "EPO Form", "Date", "Ref." and "Application No.".
- **The "Ref." field is the reference of the real representative**, not the seed file number (decision D4).

The read fields of `documents.json` (kind, dates, form, reference, printed application number) were read by a person from the page images. `registerDocumentId` is empty for rows 1 to 19: the register shows the id on its "All documents" page (the name of the row checkbox), and a person copies it there.

## Text fixtures made by FlowLeap

The register copies of the seed are scans with no text layer. A MyEPO Mailbox letter has one (founder decision of 2026-11-12, from one sandbox letter). So, to test the chain that reads a letter's text (the period of an Art. 94(3) letter, and the agent that reads the examiner's objections), the four Form 2001 letters (rows 4, 6, 8 and 16) have a text fixture. **These fixtures are made by FlowLeap. They are not EPO files and not MyEPO Mailbox files.**

- **How they are made.** Mistral OCR (`mistral-ocr-latest`, 2026-11-12) read each register copy. The OCR text is in `text-fixtures/<NN>.flowleap-ocr-text.txt`, one `=== page N of M: <register file> page K ===` line per page, with the images left out and the tables written as lines. `node fetch/make-text-fixtures.mjs` writes `<NN>.flowleap-ocr-text.pdf` from it: one PDF page for each page of the register copies, plain Helvetica text in reading order, and no date, so the same text gives the same bytes. `npm run check` fails when a PDF differs from its text.
- **How they are marked.** The file name says `flowleap-ocr-text`. The PDF's Producer and Subject say "FlowLeap test fixture: text from OCR of the public EP Register copy, not a Mailbox file". The `textFixture` of the letter's entry in `documents.json` names its sources, the OCR, the check by a person, the fixes and the changes. `check/check-seed.mjs` refuses a fixture without the mark, and a file in `text-fixtures/` that no letter names.
- **The enclosure.** A Form 2001 letter encloses its reasons (EPO Form 2906); the register lists them as a separate document. Where the seed has them, the fixture adds them after the letter, page for page, so the letter's text holds the examiner's objections: row 6 with row 7 (2 + 9 pages), and row 16 with row 17 (2 + 3 pages). Rows 4 and 8 have no Form 2906 in the seed, so their fixtures hold only the 2 pages of the letter.
- **What was checked.** A person compared the application number, the date, the reference, the form number and the period line of page 1 of each fixture with the page image of its register copy. No field needed a fix. The other text is the OCR text as Mistral gave it.
- **What they do not test.** The layout of a fixture is not the layout of a real EPO letter: the lines, the fonts, the line breaks and the positions differ, and the PDF has no images. These fixtures test the chain and the agent. They do not show that the period reader (flowleap-os `lib/record/period.mjs`) fits real Mailbox files.

The scans in `documents/` do not change. A consumer chooses the fixture explicitly (`document.textFixture.path`); the MyEPO double of flowleap-harness delivers a scan unless a test asks for the text version.

## Checks

```sh
npm test                    # behavior of the loader and the wall, and each check rejects an invalid seed
npm run check               # node check/check-seed.mjs: hashes, users, groups, walls, matters, cases, snapshots
node check/check-seed.mjs --complete   # also fails on open items (missing document ids or register snapshots)
```

An error fails the check. An open item is a named gap that a person must fill; it fails only with `--complete`.

## Add documents

1. Download the PDF from the register's "All documents" page in a browser. Do not edit it.
2. Put it at `<downloads>/<application>/<NN>.pdf` and add its entry with the read fields to `matters/<application>/documents.json`.
3. Run `node fetch/add-documents.mjs <downloads>`. It copies the PDF unchanged, writes `sha256`, `bytes`, `pages` and `textLayer`, and refuses to replace a committed PDF that has other bytes. It needs poppler (`pdfinfo`, `pdffonts`). A second run changes nothing.

## Fetch and compare the register data

`node fetch/fetch-register.mjs` writes the register snapshots through the FlowLeap CLI (`search_register`, `get_register_biblio`, `get_register_events`, `get_legal_status`, `get_bibliography`). `node check/compare.mjs` fetches them again and fails on any difference, with the matter, the tool and the JSON path. Both need a FlowLeap account with a plan (decision D6). The CLI reads its own credentials; the scripts never read or print one. On 2026-11-10 the CLI account answered `402 subscription_required`, so the `get_register_biblio` and `get_bibliography` snapshots came from the same FlowLeap tools through the FlowLeap MCP server; each snapshot's `source` says so. `compare.mjs` has not run, and the other three tools have no snapshot yet.

## License

The code and the fictional data are under the MIT license. The PDFs and the register data are copies of public documents of the European Patent Office and its register (open to inspection under Article 128(4) EPC); the MIT license does not cover them.
