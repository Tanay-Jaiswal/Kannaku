# Demo script (about 90 seconds)

Run with `npm run dev` (or the deployed link), default settings, no API key. All data is synthetic. Say "precomputed demonstration" out loud when the label appears; do not call it a live AI review.

| Time | On screen | Say |
|---|---|---|
| 0:00 | Landing page | "Hospital bills run to dozens of lines and patients rarely know what to question. Kanakku reads the itemised bill and the discharge summary and finds charges worth asking about." |
| 0:10 | Click **Try the synthetic demo bill**; progress view | "Everything here is synthetic. Five stages: reading, price matching, clinical notes, cross-examination, totals. Code does the arithmetic and price checks; the AI reads and argues but never sets a rupee figure. In this demo mode the AI stages are a precomputed demonstration, and the screen says so." |
| 0:25 | Results header and the ₹ counter | "₹7,931.44 to question out of a ₹3.4 lakh bill: ₹1,581.44 provable from the bill's own numbers and price limits, ₹6,350 to ask about. Every amount is computed by code." |
| 0:40 | Open the line-arithmetic finding (Provable) | "Provable means the bill contradicts itself: quantity times rate is lower than the printed amount." |
| 0:50 | Open the echocardiography finding; show the three columns | "Finding, what the hospital would say, our counter. Not in the summary does not mean not done, so it is a question, not an accusation." |
| 1:05 | Expand **Dropped after cross-examination** | "The ICU-days candidate was dropped: the summary explains the extra days as step-down care. Being able to drop a finding is what keeps it honest." |
| 1:15 | Untick one finding; scroll to the letter | "Pick the findings you want to raise; the total and the letter update. Edit it, print or save as PDF." |
| 1:25 | Disclaimer in the footer | "Kanakku helps you question charges. It does not decide anything is wrong, and it is not legal or medical advice." |

**Backup path:** if anything misbehaves, reload, click **Try the synthetic demo bill** again. The run needs no network beyond the page itself.

**Do not say:** "AI found" for the demonstration mode, any accuracy or savings figure, "real patients", or any word the tone rules ban (see `src/lib/config.ts`).
