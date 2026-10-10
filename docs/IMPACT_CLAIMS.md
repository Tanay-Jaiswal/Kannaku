# Impact claims you can defend

**Safe to say (each is true of this repository and can be shown):**
- Kanakku turns an itemised bill and discharge summary into a tiered list of charges to question, each with the bill lines involved, a code-computed rupee amount and a cited rule or source.
- Every rupee amount is computed by deterministic code; an automated guard rejects any figure an AI model writes that code did not supply.
- Each finding is argued by an Auditor, answered by a Defender and decided by a Judge, and findings the documents explain are dropped and shown, not hidden.
- The Judge is limited by code: it can lower a finding's tier but never raise it or change an amount.
- On the three built-in synthetic bills, the scripted checks match the answer keys: 11 seeded errors are flagged, the 3 designed traps are dropped, the clean bill shows ₹0.00 and 9 decoy lines are not raised (`npm test`, `npx tsx scripts/check-fixtures.ts`). This shows the pipeline is wired correctly on constructed data, **not** accuracy on real bills.
- It produces an editable, non-accusatory letter that asks the billing desk for the supporting records.
- Safeguards are built in: not-legal-advice disclaimer, synthetic-data labelling, explicit partial/skipped states, upload limits and spend caps.

**Do not claim:**
- Any number of users, bills reviewed, rupees saved or recovered, or time saved.
- Any accuracy, precision or recall on real bills, or any real-world validation or hospital/insurer endorsement.
- That findings prove overcharging or that a hospital acted improperly. Only a bill contradicting its own printed figures, or a medicine above a verified price limit, is "Provable", and even then the hospital's records decide.
- That the AI reviewed the sample bills live, in the default demo mode (it is a precomputed demonstration).
- That the reference prices are official. The table is hand-curated and only 4 of 16 rows are verified for the hackathon.
- Coverage beyond India, inpatient itemised bills, and the three detectors.

Anything broader needs evidence you have collected and can show.
