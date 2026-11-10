# 0001. Money is integer minor units with largest-remainder rounding

Date: 2026-11-09. Status: accepted.

## Context

A bill splitter lives or dies on whether the per-person amounts add up to the receipt. Floating point cannot represent 0.10 exactly, and naive rounding of each share loses or invents cents: $100.00 three ways is 33.333..., and three rounded shares of 33.33 leave a cent nobody pays. The engine also has to support fractional shares such as "one bite" at 10% and tax and tip spread in proportion to what each person had.

## Decision

- Every amount is an integer in the currency's minor unit (cents, yen, fils) and typed as `Cents`, a branded `number` validated with `Number.isSafeInteger`. Arithmetic is integer only and throws on overflow rather than losing precision. Formatting converts to a decimal string before handing the value to `Intl.NumberFormat`, so floats never touch money.
- One function, `allocate(total, weights)`, divides money. It computes each exact proportional share, takes the floor of each, and hands the leftover units one at a time to the shares with the largest fractional remainders. Ties go to the lower index. This is the largest-remainder (Hamilton) method.
- Every split kind (equal, percent, shares) and every receipt-level adjustment (tax, tip, fee, discount with proportional, equal or payer allocation) reduces to weights and goes through `allocate`. Exact splits are checked to sum to the amount instead.
- Negative totals (discounts) are allocated as the negation of the positive allocation, so a discount rounds the same way as the charge it offsets.

## Consequences

- Invariants the test suite enforces with property-based tests: the shares always sum to the total; each share is within one unit of its exact share; zero weights get zero; allocation is deterministic; `sum(totals) == sum(items) + tax + tip + fee - discount` for any receipt; debt simplification zeroes every balance with at most n-1 transfers.
- Worked example used as the golden test: three items (burger $15.00 for Ana; pizza $24.00 split 90% Ana, 10% Bo; three salads at $3.00 split equally), tax $3.96 and tip $8.64 proportional, $5.00 discount equal. Subtotals 39.60 / 5.40 / 3.00; tax 3.27 / 0.44 / 0.25; tip 7.13 / 0.97 / 0.54; discount -1.67 / -1.67 / -1.66; totals 48.33 / 5.14 / 2.13, which sum to the receipt total of 55.60.
- Persisting amounts as integers (`bigint` columns) keeps the database free of decimal drift; the API carries cents as JSON numbers and a currency code per expense.
- Weights are floats, so a share can in rare cases land one unit away from a hand calculation that used exact rationals. Totals are still exact, which is the property users notice.
