# Reference OCR spike gate

Date: 2026-06-01

## Decision

No real Chinese scanned consulting PDFs were available in this implementation session, so the scanning/multimodal branch is shipped in fail-loud gated mode by default.

- Digital text references and digital PDF/Office extraction are enabled.
- Mixed/scanned documents keep the original binary when partial text exists, but Claude OCR is only attempted when `BOULE_ENABLE_CLAUDE_REFERENCE_OCR=1` is set.
- Without that explicit opt-in, scanned documents are marked `failed` (or `partial` when local text exists) with `CLAUDE_REFERENCE_OCR_DISABLED`, so unusable OCR text cannot silently enter `sources/` context.

## Follow-up validation

Before enabling `BOULE_ENABLE_CLAUDE_REFERENCE_OCR=1` in production, run 5-10 real Chinese scanned consulting PDFs through the upload path and manually inspect extracted text quality. If quality is unacceptable, keep scanned documents fail-loud and ask users for digital originals.
