# Screenshots to capture from the real running app

Run `npm run dev` on your machine and capture at 1366x768 or larger (browser zoom 100%), using the synthetic samples only. Do not include your terminal if it shows a key. Remove any browser bookmarks or tabs from the frame.

| # | Screen | How to get it | Must be visible |
|---|---|---|---|
| 1 | Landing page | Open `/` | Hero, "Try the synthetic demo bill", upload section with the "uploads are switched off" explanation |
| 2 | Sample bills section | Scroll to "Synthetic sample bills" | "Precomputed demonstration" note, Synthetic data badges |
| 3 | Progress view | Click the demo button (the stage notes appear for a second or two) | Five stages, "demonstration script, no AI model" note |
| 4 | Results top | Wait for results | ₹7,931.44, Provable / Ask split, "Synthetic data" and "Precomputed demonstration" badges |
| 5 | Findings by tier | Scroll | Provable and Ask groups with checkboxes |
| 6 | Finding detail | "Show evidence and review" on the echocardiography finding | Finding / Hospital would say / Our counter, Judge verdict, source citation |
| 7 | Dropped finding | Open "Dropped after cross-examination" | ICU-days finding with the explanation |
| 8 | Selection and totals | Untick one finding | Selection bar total changed |
| 9 | Letter (preview) | Scroll to the letter | "Demo letter, not for sending" badge |
| 10 | Letter stale warning | Edit the letter, then untick a finding | Amber warning, Print disabled |
| 11 | Print layout | Click Print / Save as PDF | Only the letter, ₹ renders correctly |
| 12 | Clean sample | Run "Laparoscopic cholecystectomy" | ₹0.00 and "1 candidate explained by the documents and dropped" |
| 13 | Mobile | Browser device mode at 375 px: landing and results | No horizontal scrolling |
| 14 | Error state (optional) | Stop the dev server, then click the demo button | "The audit could not be completed", "not a clean bill" |
| 15 | Disclaimer | Footer | Full disclaimer text |

Screenshots in the repo root (`homepage.png`) predate the redesign; replace or delete it before submission.
