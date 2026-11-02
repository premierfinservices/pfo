# Local OCR design: reading documents on the server, not at Anthropic

**Status:** Accepted in outline by Tarun, 2 Nov 2026 (answers in section 12). Written on the Unfold Media Corp PC. Nothing is built. The spike has run (section 13) and favours **Surya on the GPU** over Tesseract; the choice is provisional until the full accuracy run (section 9, step 6).
**Decided (30 Oct and 2 Nov):** reading by content is done locally, instead of sending documents to Anthropic's API. Tarun will not pay for a separate API account, so **nothing in PFO calls Anthropic, now or as a fallback.** Property documents arrive mostly in Tamil, so Tamil is a first-class requirement, not a second pass.
**This design replaces:** the reading part of ADR-041 (`Backend/file-reading.ts` calling `classifyAttachment`). When accepted it becomes ADR-045.
**Repo is public:** this file contains no customer data and must not gain any. Accuracy figures from real folders go in as aggregate numbers only.

## 1. What problem this solves

A customer's file arrives as `IMG_2231.JPEG` or `DOC-WA0016.pdf`. The name says nothing, so step 1 of the document drop files it as Other Document and a person has to open it. ADR-041 fixed that by sending the file to a model. This design does the same job on the server itself, so no customer document leaves the building.

On real case folders, 2,184 of 2,693 files (81%) were recognised from their names alone. **The OCR only has to deal with the other ~19%**, mostly unrenamed WhatsApp images. That is the size of the prize and the size of the job.

## 2. Scope

| In | Out (separate decisions) |
|---|---|
| Deciding what an unnamed uploaded file is (document type, and month or year where it has one) | Working out GST and ITR figures (step 3) |
| One shared text-extraction layer that step 3 can reuse | Reading handwriting, or extracting fields for their own sake |
| Removing the API call from the upload path | |
| **Phase 2, same engine:** inbound bank-reply attachments (`Backend/inbound-classification-client.ts`), then deleting the Anthropic client altogether | |

## 3. The key observation: most files need no OCR at all

Three kinds of input arrive, and only one needs OCR.

| Kind | Examples | How it is read |
|---|---|---|
| **PDF with a text layer** | GSTR-3B downloaded from the GST portal, ITR acknowledgements, net-banking statements, e-Aadhaar | Read the text straight out of the PDF with `pdfjs-dist`. Fast, exact, no OCR |
| **Scanned PDF** | Phone-scan apps, office scanners | No usable text layer, so render the first pages to images, then OCR |
| **Photo** | WhatsApp JPEG of a PAN card or a cheque | OCR directly, after cleaning the image |

The rule: **try the text layer first; OCR only when a PDF yields almost no text, and always for images.** "Almost no text" is a measured threshold (start at under 40 characters per page), to be tuned in the spike.

This matters twice. It makes the common case fast and exact. And it gives step 3 what it needs, because GSTR-3B figures must come from the text layer, never from OCR of a photo of a number.

## 4. The pipeline

```
file bytes
  -> extract text        (text layer, else render + OCR)         Backend/text-extraction.ts, Backend/ocr.ts
  -> classify the text   (pure rules, no I/O)                    src/domain/work/content-rules.ts
  -> FileMatch           (same shape readByContent returns now)  Backend/file-reading.ts
```

`readByContent(client, file)` keeps its signature and its return type (`FileMatch | null`). `Backend/work.ts` does not change, except that the `readByAi` flag and the screen text say "read by content", not "read by AI".

## 5. Classifying the text (the part that decides accuracy)

Pure functions over a string, unit-tested with synthetic text fixtures. No network, no files.

| Evidence | Why it is trusted |
|---|---|
| **Identifiers with a checksum or fixed shape.** PAN (`AAAAA9999A`; the fourth letter says individual, company, firm). Aadhaar (12 digits, Verhoeff check). GSTIN (15 characters, check character). IFSC. Voter ID (EPIC). Udyam number | A random OCR slip rarely produces a string that passes the checksum, so a pass is strong evidence |
| **Title phrases.** "GSTR-3B", "Acknowledgement", "Income Tax Return", "Statement of Account", "Balance Sheet", "Computation of Income" | Cheap and, on official forms, reliable |
| **Context words** that must co-occur (bank name plus IFSC plus "Account No" for a statement) | Stops one stray word from filing a document |
| **Period.** "Period: April", "Financial Year 2025-26", "Assessment Year 2025-26", statement date ranges | Feeds the same month and April-to-March logic `file-reading.ts` already trusts (`periodFrom`) |

Each document type has a small rule set: required evidence, optional evidence, and a score. **Confidence is computed from the evidence that fired, not reported by a model**, so the same file gives the same answer every time. That removes ADR-041's complaint that the model's answer was not reproducible.

Two safeguards carry over from ADR-041 unchanged: an answer is used only at confidence 0.75 or more, and only for a document type PFO has (`document_type`, active, customer artifacts, not `other_document`). Anything else stays Other Document.

**Masked Aadhaar** (customers send "XXXX XXXX 1234") cannot pass the checksum. The rule for it leans on "Aadhaar", "UIDAI" and "Government of India" and caps its own confidence lower.

**The rules live in code, not the database.** A new document type needs new rules written and tested, so a developer adds them. If the office later needs to edit them, that is a separate piece of work.

## 6. OCR specifics

| Topic | Decision |
|---|---|
| Engine | **Chosen by the spike**, between two candidates (below). Tamil quality is the deciding test |
| **Privacy trap** | By default `tesseract.js` downloads its language data and core from a CDN at runtime. That would be a network call from the server, which defeats the point. All three paths (`workerPath`, `corePath`, `langPath`) must point at local files, and caching must be disabled or local. A test must prove it works with the network blocked |
| Language data | Not committed. A script (`npm run ocr:models`) fetches it once, checks a hash, and writes to `PFO_OCR_MODELS_DIR` (for example `C:\PFO\ocr-models`). After that the server never fetches anything |
| PDF to image | `pdfjs-dist` for parsing. Rendering scanned pages needs a canvas, so add `@napi-rs/canvas` (a prebuilt native module delivered by npm, nothing installed system-wide). It also decodes WebP, which Tesseract does not read directly |
| Image cleaning | Downscale to about 2,500 px on the long side, grey, normalise contrast. Rotated phone photos: try the orientation Tesseract detects, and 90-degree turns only when the first pass is poor |
| Pages | First 2 pages of a PDF are enough to name a document. GSTR-3B and statements name themselves on page 1 |
| Concurrency | One worker, one file at a time, lower priority. The Unfold PC also runs Postgres, the API and mail for 9 people |
| Budget | A time budget per file (start at 20 s) and per request (60 s). Over budget means Other Document and a line in the result, never a hang |
| Failure | Any error returns null. Same as today: nothing is lost, nothing is guessed |

**Library behaviour and the claims above are not yet verified on this machine.** `package.json` has an `allowScripts` block, so confirm none of these packages needs an install script. See the spike in section 9. Latest versions seen on npm today: `tesseract.js` 7.0.0, `pdfjs-dist` 6.5.438 (needs Node 22.13+; this PC has 24.18), `@napi-rs/canvas` 1.1.0.

## 7. Where it runs, and why per file is enough

The upload client sends one file per request (`apiUpload`), so reading happens inside that request. At roughly 3 to 8 seconds per scanned or photographed page (an estimate, to be measured) that is acceptable per file. A folder drop uploads one file after another and the screen already shows progress.

The exception is a zip with many unnamed images, which would hold one request for minutes. The per-request budget in section 6 handles that: files past the budget are filed as Other Document and listed as "not read: ran out of time", so the person knows to drop them again or place them.

**Not proposed now:** a background job table that files first and re-reads later. It is better for big folders and costs a migration and extra states (a document that gets renamed after the person has looked at it). Build it only if the measured folder-drop time is unacceptable.

## 8. Tamil, and the hardware we have

**Tarun's answer: property documents (patta, chitta, encumbrance certificate, sale deed and the like) mostly arrive in Tamil.** PAN, GST, ITR and bank statements are English and are the easy majority. So the engine must read Tamil well enough to name a document type from a few Tamil words ("பட்டா", "சிட்டா" and so on), and that is where the choice is made.

**Hardware (to confirm on the Unfold PC in the spike):** 16 GB RAM, RTX 5060 with 8 GB VRAM. OCR models are small next to language models, so 8 GB of VRAM is plenty for this job (estimate, to be measured). RAM is the tighter resource: Postgres, the API, mail and the browser share the 16 GB. The GPU is also used for editing work, so OCR must not assume it is free.

| | A. Tesseract (`tesseract.js`, CPU) | B. A GPU OCR engine behind a local service (for example PaddleOCR, EasyOCR or Surya) |
|---|---|---|
| Install | npm only, no system software | Needs Python and a CUDA-enabled build on the server, run as a loopback-only service the Node API calls |
| Tamil | Supported (`tam` data), generally the weaker of the two on Tamil. Fine on clean scans, poor on photos | Newer engines are generally stronger on Tamil and on phone photos. **Not verified here** |
| Speed | Seconds per page on CPU | Faster per page on the GPU, plus a model-load cost at start |
| Risk | Accuracy on Tamil photos | Setup and upkeep. The RTX 5060 is a very new card, and Python GPU libraries may need current builds to support it. **Check in the spike before choosing B** |
| Failure mode | Returns little text, file stays Other Document | Service down: file stays Other Document. Never falls back to the API |

**What the published evidence says (searched 2 Nov 2026; it does not settle the question).** There is no authoritative 2026 Tamil leaderboard, and the studies disagree:

- A 2024 comparison of five open libraries on Tamil scored Tesseract 78%, MMOCR 72%, Keras OCR 70%, EasyOCR 62% and PaddleOCR 59% ([ICON 2024](https://aclanthology.org/2024.icon-1.48.pdf)). Small study, older engines.
- A 2025 zero-shot study on Sinhala and Tamil found Surya and Google Document AI the strongest, with Surya clearly best on Sinhala. Its test set is synthetic subtitle text, not scanned documents ([arXiv 2507.18264](https://arxiv.org/pdf/2507.18264)).
- PaddleOCR's PP-OCRv5 now ships a dedicated Tamil recognition model, reported at 94.2% on its own small test set ([PaddleOCR docs](https://www.paddleocr.ai/latest/en/version3.x/algorithm/PP-OCRv5/PP-OCRv5_multi_languages.html)). That figure is the vendor's, on 2,121 images, so it is not comparable to the table above.
- The RTX 5060 is a Blackwell card (compute capability sm_120). PyTorch builds for CUDA 12.8 and later include it, but Windows reports are mixed ([PyTorch forum](https://discuss.pytorch.org/t/pytorch-support-for-sm120/216099?page=3)). I found nothing on PaddlePaddle for this card.

**My reading, as a judgement and not a result.** Our job is easier than the benchmarks: we only need to *name* a document, from a few header words and identifiers, not transcribe a page. Tamil property papers like patta and chitta are mostly computer-printed in clean fonts, which suits any engine. So the likely ranking is Tesseract as the simplest baseline, Surya as the most probable winner if Tesseract's Tamil is too weak on photos, and PaddleOCR as the third candidate. I would not pick one without running them on your own Tamil documents. Check Surya's model licence terms before relying on it commercially.

**The spike decides, with Tamil documents in it** (section 9, step 0). It is a bake-off of all three on the same files. If A reads Tamil keywords well enough to hit the precision bar, choose A: it is the simpler thing to own. If it does not, choose B, accepting a Python service on the server, and say so in ADR-045. Either way the rules layer (section 5) is the same, including Tamil keyword rules.

Files are read English-first, then with Tamil enabled when nothing was recognised, so the common English case does not pay for Tamil. If the spike shows the Tamil pass is cheap enough, run both together.

## 9. Order of work

| # | Step | Proof it is done |
|---|---|---|
| 0 | **Spike, on the Unfold PC in a scratch folder.** Try A (`tesseract.js` with English and Tamil, plus `pdfjs-dist` and `@napi-rs/canvas`) on about 30 real unnamed files **including Tamil property documents**. Also run Surya and PaddleOCR (PP-OCRv5 Tamil) on the same files, and check each runs on the RTX 5060 | Works with the network blocked. Seconds per page, RAM and VRAM noted. Tamil keywords found, per engine. **Engine chosen, or no-go** |
| 1 | `content-rules.ts` with identifier validators and rules for the common types | Unit tests on synthetic text, including near-miss text that must not match |
| 2 | Text-layer extraction | A text PDF is classified with no OCR run |
| 3 | OCR path | A photo and a scanned PDF classify; network-blocked test passes |
| 4 | Wire into `readByContent`, remove the API call from this path, rename "read by AI" in the screen and result | `Backend/work.test.ts` passes; an unnamed file still lands in Other Document when reading fails |
| 5 | Write what was read (rule ids and confidence, **not** the OCR text) to the upload event | Closes ADR-041's "not written to an audit table" limit. Probably no migration |
| 6 | **Accuracy run on real folders** (below) | Numbers meet the bar, or the threshold is raised |
| 7 | ADR-045, update `Docs/Resume on Home PC.md`, deploy per "How a change reaches production" | |
| 8 | **Phase 2:** move inbound bank-reply classification onto the same engine, then delete `Backend/inbound-classification-client.ts`'s Anthropic call and `PFO_ANTHROPIC_API_KEY` | `rg -i anthropic` finds nothing in code or `.env.example` |

### The accuracy run (step 6)

The 2,184 files already named by `organize` are free labelled data. Copy them, strip the names, run the pipeline, compare with the known type. Run it on the Unfold PC only, since the files are customer documents. Nothing but counts leaves it.

Proposed bar, to be confirmed:

- **Precision at least 98% on the types it files.** A wrong confident answer files a document under the wrong heading with no warning. That is worse than Other Document, so precision outranks recall.
- Recall is reported per type. A target below the model's is expected and acceptable for photos; for text PDFs it should be near complete.
- The 0.75 threshold is raised for any type that misses the precision bar.

## 10. What changes in the code

| File | Change |
|---|---|
| `src/domain/work/content-rules.ts` (+ test) | New. Pure |
| `Backend/text-extraction.ts`, `Backend/ocr.ts` | New |
| `Backend/file-reading.ts` | `readByContent` uses the above; same signature |
| `Backend/inbound-classification-client.ts` | Untouched until open decision 2 |
| `.env.example` | `PFO_OCR_MODELS_DIR`, `PFO_OCR_BUDGET_MS`, and a switch to turn reading off |
| `package.json` | `pdfjs-dist`, `@napi-rs/canvas`, and `tesseract.js` if engine A wins. Engine B adds a Python service outside npm |
| `Frontend/src/screens/UpdateCase.tsx` (upload card) | Wording only |

## 11. The tradeoffs, stated

- **Lower recall than the model** on blurry, glared, skewed or low-resolution photos. Those files go to Other Document, as unnamed files do today, and a person places them.
- **More code to own.** The model needed no rules. Every new document type now needs rules and tests.
- **The office PC does the work.** OCR is CPU and memory heavy on a machine that also serves the whole office. The single worker, the budgets and the spike's measurements exist to keep that bounded.
- **Reproducible and private.** Same file, same answer. No document leaves the server. Anthropic's API is no longer part of the upload path, so ADR-041's privacy caveat and the CA or lawyer question no longer apply to uploads.
- **No Anthropic anywhere.** There is no API account to pay for, and no fallback. Until phase 2, inbound bank-reply attachments are not classified at all (no key means confidence 0, so they go to the review queue, which is how it behaves today). Nothing leaves the server in the meantime.

## 12. Decisions

**Decided by Tarun, 2 Nov 2026**

| # | Question | Answer |
|---|---|---|
| 1 | Do property documents often arrive in Tamil? | Yes, mostly. Tamil is a first-class requirement (section 8) |
| 2 | Keep the Anthropic API for anything? | No. It needs a separate payment Tarun will not make. Do all of it locally, including inbound bank replies (phase 2). Hardware: 16 GB RAM, RTX 5060 8 GB |
| 3 | Use the already-named real case files as the accuracy test set, on the Unfold PC only, counts only? | Yes |
| 4 | Fall back to the API when local reading fails? | Never |

**Still open (proposed defaults stand unless Tarun says otherwise)**

| # | Question | Default |
|---|---|---|
| 5 | Precision bar of 98%, with "wrong is worse than unfiled"? | Yes |
| 6 | Read inside each upload request, or build a background job? | Per request now; revisit after measuring |
| 7 | Engine A (Tesseract) or B (Surya on the GPU)? | **B, provisionally**, from the spike (section 13). Confirm after the full accuracy run, and after checking Surya's model licence |

## 13. Spike results (2 Nov 2026, Unfold PC, scratch folder outside the repo)

**What was run.** 76 real files, read in place and never copied, chosen by a fixed random seed: 64 already named by `organize` (so the type is known) across nine types, and 12 unnamed. Each engine used the same flow: text layer first, OCR when needed, first 2 pages. A file counted as "right" when the text held evidence for its known type (crude keyword probes written for the spike, **not** the production rules in section 5). Only counts were looked at; no extracted text was read or stored. The spike code and result data stay in `C:\PFO\Spike\ocr` on the Unfold PC.

**Results (files right, of those sampled)**

| Type | n | Tesseract eng | Tesseract eng+tam (full run) | Tesseract best (see note) | Surya 0.17, GPU |
|---|---|---|---|---|---|
| GSTR-3B | 8 | 8 | 8 | 8 | 8 |
| Aadhaar | 8 | 8 | 8 | 8 | 8 |
| PAN card | 8 | 2 | 2 | 2 | **8** |
| Bank statement | 8 | 7 | 7 | 7 | 7 |
| ITR | 8 | 6 | 6 | 6 | 6 |
| Sale deed (Tamil) | 8 | 0 | 4 | 4 | **5** |
| Encumbrance cert. | 7 | 3 | 3 | 5 | **7** |
| Patta (Tamil) | 8 | 1 | 4 | 6 | 6 |
| Chitta (Tamil) | 1 | 1 | 1 | 1 | 1 |
| **Total** | 64 | 36 | 43 | about 46 | **56** |
| Unnamed files with any evidence | 12 | 4 | 5 | 6 | **8** |

"Tesseract best" is assembled from separate runs: the text-layer fallback below was measured only on the property types and ITR, and image cleaning (upscale, grey, contrast) did not help PAN. It is an upper estimate for Tesseract, not one run.

| | Tesseract (CPU) | Surya 0.17 (RTX 5060) |
|---|---|---|
| Speed per file | about 0.5 to 4 s average by type | about 1 to 7 s average by type |
| Memory | about 0.7 GB RAM | peak 4.5 GB VRAM |
| Network | **Zero blocked connections** under an offline guard on every thread | Needs a one-time model download, then local |
| Install | npm only. The one blocked install script is a donation banner | Python 3.10 environment, pinned versions (below) |

**What the spike found, and what changes in the design**

1. **A text layer is not proof of readable text.** Several EC and patta PDFs had a text layer with no Tamil, or with odd symbols, consistent with older Tamil fonts that are not real Unicode (cause inferred, not proven). Reading the page by OCR when the text layer matches nothing lifted ECs from 3 to 5 of 7 and pattas from 4 to 6 of 8 with Tesseract. **Section 3 is amended: try the text layer; if it yields no evidence for any type, OCR the page.**
2. **Scanned sale deeds have no text layer** (3 of the 4 PDFs checked), so Tamil OCR is unavoidable for them. Both engines found "sale deed" evidence in only 4 to 5 of 8 on pages 1 and 2: those pages are often stamp-paper pages that never say it. **Section 6's "first 2 pages" rule needs a second look for deeds** (read more pages, or accept Other Document).
3. **Tesseract is poor on PAN card photos** (2 of 8). Surya read all 8. PAN is a key document, so this matters more than the Tamil gap.
4. **Surya's newest release (0.23) runs its model inside Docker**, which this PC does not have; every file errored. The working setup is **Surya 0.17.0 on Python 3.10, PyTorch 2.11.0 built for CUDA 12.8, transformers below version 5** (version 5 breaks it), plus `requests`. This is pinned and fragile, and must be recorded exactly in the ADR and kept out of the main `npm` tree.
5. **The RTX 5060 works with that PyTorch** (`sm_120` is in the build). The earlier worry about Blackwell support is cleared for PyTorch.
6. **PaddleOCR (Tamil model) was not completed.** It failed on CPU until the MKLDNN path was disabled, then ran at about 45 s per file with the machine busy. Its GPU build for this card was not tried. It is not a candidate for per-upload reading as it stands.

**Limits of this evidence (read these before trusting the table)**

- **Small and uneven.** 76 files, and only 7 to 8 each of the Tamil property types, 1 chitta. Three or four files change a row.
- **Crude probes.** "Evidence for the expected type found" is not the same as "correctly classified with no false match". Both engines showed a few cross-matches (for example an ITR also matching a bank keyword), which belong to the probes, not the engines. **Precision, the real bar (section 9), has not been measured.**
- **Not one clean experiment.** Prep, fallback and language settings were tried in turns, so the Tesseract column is a best case.
- **VRAM is shared.** The desktop used between 2.5 and 3.9 GB of the 8 GB during the spike. Surya's 4.5 GB peak fits, but only just, and video editing at the same time could make a read fail. Mitigation to test: a smaller recognition batch size, and any GPU failure files the document as Other Document.
- **One file errored** ("document closed or encrypted"), a password-protected PDF. It is filed as Other Document by design.

**Licence, to check before relying on Surya.** The Surya code is Apache-2.0. The **model weights carry a separate licence**: free for research and personal use, and for organisations under a funding and revenue limit (most sources say $5M; one says $2M; older releases were GPL). It may also restrict use in products that compete with its maker. Premier Finservices is very likely under the limit, but read the `MODEL_LICENSE` file in the Surya repository before deciding, and record the answer in ADR-045. Sources: [Surya model-licence summary, 2 Nov 2026 search](https://huggingface.co/pitapo/surya/blob/main/README.md), [Surya OCR 2.5 release note](https://aiweekly.co/node/21328).

**Recommendation.** Take engine B (Surya on the GPU, run as a loopback-only Python service the API calls), provisionally. It reads PAN cards, ECs and unnamed photos clearly better, and is as fast. Keep Tesseract as the **named fallback if the GPU is unavailable or the licence does not suit**, since it needs no Python, no GPU and no licence question, and still reads English documents well. Do not build either until the full accuracy run (section 9, step 6) confirms the 98% precision bar on the real named files; that run needs the section 5 rules, so it comes after steps 1 to 3.

**Not tried:** a vision-language model that fits in 8 GB, fine-tuned Tamil models, and a Surya GPU batch-size sweep.
