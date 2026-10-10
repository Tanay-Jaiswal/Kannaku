# Kanakku
Adversarial AI hospital-bill auditor for Indian patients. **Synthetic data only.** See SPEC.md.
Status: Phase 1 (Next.js App Router + Tailwind foundation, static homepage). Setup: `npm install && npm test && npm run typecheck`, then `npm run dev` and open http://localhost:3000.

Data checks:
```bash
npx tsx scripts/make-answer-keys.ts   # regenerate answer keys from truth JSON + drug table
npx tsx scripts/check-fixtures.ts     # consistency checks (also run by npm test)
```

The reference drug table is hand-curated. Rows marked `verified: false` (currently paracetamol and ondansetron) are "Illustrative reference value for demo, not official." `verified: true` reflects the hackathon data gate, not regulatory certification; re-check sources before any real-world use.
