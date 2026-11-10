# 0003. Receipt extraction with Claude vision behind an OcrProvider

Date: 2026-11-09. Status: accepted.

## Context

The core feature is turning a receipt photo into editable line items with quantities, prices, tax, tip and totals. Candidates: Tesseract (free, poor on receipts, no structure), AWS Textract AnalyzeExpense (purpose-built, returns line items, about $0.10 per page, weak on handwriting), and a vision-capable LLM returning a schema-validated JSON document.

## Decision

Use Claude (`claude-opus-5-5`) through the official TypeScript SDK with structured outputs: the worker sends the re-encoded receipt image plus a short instruction and receives a `ReceiptExtraction` object validated by a shared Zod schema (merchant, date, currency, items with per-item confidence, subtotal, tax, tip, discounts, total). The worker checks that items plus adjustments reconcile with the printed total and marks the receipt `needs_review` when they do not. Token usage and cost are recorded per receipt. The call sits behind an `OcrProvider` interface with a fixture provider for tests and offline development, so Textract or a cheaper model can be swapped in without touching the pipeline.

## Consequences

- Cost is roughly one to three cents per receipt, cheaper than Textract, and tracked in the database.
- Accuracy is measured, not assumed: a golden set of real receipts with expected JSON runs nightly and the numbers go in the README.
- Receipt images leave AWS for the inference call. Photos are stripped of EXIF metadata before upload and never contain account data, which is acceptable for this product.
- Model or provider changes are a configuration change plus a golden-set run.
