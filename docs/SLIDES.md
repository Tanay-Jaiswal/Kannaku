# Seven-slide outline

No hackathon instruction in `SPEC.md` fixes a slide count (there is no `strategy.md` in the repo), so this uses seven slides. Use screenshots from the running app (see `docs/SCREENSHOTS.md`), synthetic data only.

1. **Title and one-line pitch.** "Kanakku: upload your hospital bill; it finds what you should question, shows the evidence, and anticipates the hospital's reply." Track: AI for Everyday Life. Synthetic-data note in the footer.
2. **The problem.** Itemised inpatient bills are long and technical; patients cannot easily check arithmetic, medicine prices, bed-days or whether services appear in the clinical record. State this qualitatively. No statistics unless you can cite a source you have verified.
3. **What Kanakku does (demo screenshot).** Bill and discharge summary in; tiered findings, evidence, dropped findings and an editable letter out. Show the results page with the ₹ counter and the Provable / Ask split (labelled synthetic).
4. **How it works (architecture diagram).** `docs/architecture.svg`. Emphasise: code does all math and lookups; AI extracts, reasons and argues; a number guard stops the AI producing figures.
5. **The adversarial Rebuttal Engine.** Auditor, Defender, Judge; the three-column finding screenshot; one dropped example (ICU days explained by the summary). Code limits the Judge: tier only goes down, amounts never change.
6. **Responsible by design, and honest about the demo.** Questions, not accusations; reference benchmarks are not legal limits; disclaimer; labels distinguishing live, recorded and precomputed-demonstration results; partial audits never shown as complete; synthetic data; spend controls and cache-only default. Say plainly that the public demo uses a precomputed demonstration unless you have recorded a live review.
7. **Impact, limits and next steps.** Defensible claims from `docs/IMPACT_CLAIMS.md`; limitations (synthetic only, 16-row hand-curated drug table, India only, not validated on real bills); next steps (expand the verified reference table, validate extraction on consented real documents, insurance and package checks, regional languages).
