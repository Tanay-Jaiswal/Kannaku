# Architecture

See the diagram in `docs/architecture.svg` (also in the README as Mermaid).

**Flow:** documents, extraction, deterministic rules (D1 arithmetic and duplicates, D2 medicine prices), clinical checks (D3 ICU days by code, "not in summary" candidates by AI), candidate findings with code-computed amounts, adversarial review (Auditor, Defender, Judge), code-side finalisation, tiered findings and letter.

**Safeguards**
- The model never produces a rupee figure; a number guard rejects any amount or percentage code did not supply.
- Judge decisions are constrained by code (tier only goes down; amount never changes; a Provable finding is dropped only on a data error).
- `/api/finalize` re-runs the rules on the server and re-derives every amount; nothing from the browser can change an amount or raise a tier.
- Every model output is zod-validated, tone-linted, retried once, then fails loudly.
- Sample runs never call a model. Uploads need a key, models and `KANAKKU_CACHE_ONLY=0`, plus per-run, per-day and per-IP limits.
- Results carry a `review_source` (`live_ai`, `recorded_ai`, `demonstration`) set by the server and shown in the UI.
