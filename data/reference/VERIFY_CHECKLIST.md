# Drug table verification checklist (round 1: 6 rows)

File to edit: `data/reference/drug_reference.json`. Every price field is `null` on purpose; I will not guess prices.
Budget: about 5 minutes per row, 30 minutes total. The other 10 rows (including IV fluids) stay unverified and are not used in seeds.

## Round 1 rows
1. paracetamol_650_tab  2. pantoprazole_40_inj  3. ceftriaxone_1g_inj
4. amoxclav_625_tab  5. azithromycin_500_tab  6. ondansetron_4mg_inj

## Per-row steps
1. **MRP.** Find one real pack of a common brand (manufacturer site, a pharmacy listing showing the printed MRP, or the pack label). Record:
   - `mrp_per_pack` (rupees, printed MRP, taxes included)
   - `pack_size` (number of `table_unit`s in that pack, e.g. 10 tablets, 1 vial)
   - `allowed_pack_sizes` (all pack sizes you saw, e.g. [10, 15])
   - one brand in `brand_examples`, `mrp_source` (URL or "pack label, brand X"), `source_retrieved_on` (YYYY-MM-DD)
2. **Scheduled or not.** Check whether this formulation is under NPPA price control (nppaindia.nic.in ceiling price lists, or the NPPA app; confirm the app name yourself). Set `nlem_scheduled` true/false.
3. **GST.** Record `gst_pct` for the formulation (the rate applied on the pack; confirm from the source or the GST rate schedule). Needed for every row you verify, scheduled or not.
4. **Ceiling price, only if scheduled.** Record `ceiling_price_per_unit` (rupees per `table_unit`, **ex-GST**, as NPPA lists it; if the list uses a different unit, convert and say so in `notes`) and `ceiling_source_ref` (notification number/date or list name and date).
5. **Sanity check (corrected).** NPPA ceilings are per unit and exclude GST; MRP = ceiling plus taxes at most, and brands may price below ceiling. So for scheduled rows this must hold:
   `mrp_per_unit <= ceiling_price_per_unit * (1 + gst_pct/100)`
   where `mrp_per_unit = mrp_per_pack / pack_size`. If it fails, re-check the unit, the pack size or the GST rate. `npm test` runs this check (`validateTable`) and names the failing row.
6. Set `verified: true` only when steps 1-3 (and 4 if scheduled) are done. Verified rows must have MRP, pack size, source, date, `nlem_scheduled` and `gst_pct` filled, or the test fails.

## Seeds after round 1
- S2-2 and S3-2 (drug billed above printed MRP) work whether or not the drugs are scheduled.
- S2-3 needs one verified scheduled drug so the finding can also cite its ceiling. If none of the 6 turns out scheduled, I reword S2-3 to a plain "above printed MRP" seed on another drug.
- You need at least **4 verified rows** for seeds plus decoys.

## What I need back
The edited JSON (paste or upload), or the list of rows done. Mark anything unsure in that row's `notes`.

## Status after merge (round 1 values from the Phase 0 bundle, 2026-10-10)
Values were entered exactly as the bundle had them; nothing was added or re-priced. All 6 pass the sanity check in step 5, which by itself never makes a row verified.

| Row | verified | Still to check |
|---|---|---|
| paracetamol_650_tab | false | Pack MRP (₹27.30 / 15) is from counterfoil.in, an aggregator; needs a pharmacy or manufacturer spot-check of the exact pack |
| ondansetron_4mg_inj | false | MRP (₹6 / 2 mL) is a PharmEasy "lead"; ceiling is from the 27-05-2026 list while the others use 27-08-2026; priced per mL |
| pantoprazole_40_inj | true | MRP from counterfoil.in; confirm it is a printed MRP, not a discounted price. MRP is about a third of the ceiling |
| amoxclav_625_tab | true | MRP from counterfoil.in; confirm printed MRP |
| azithromycin_500_tab | true | MRP from counterfoil.in; confirm printed MRP. MRP is about a quarter of the ceiling |
| ceftriaxone_1g_inj | true | MRP from a pingmedoc.com listing; confirm printed MRP |
| all 6 | | Spot-check each ceiling against the Kerala Drugs Controller PDF; GST 5% cites Notification 9/2025 entry 226, subject to product classification |

Low-priced reference brands no longer cause false Provable findings: a bill-printed MRP always replaces the reference MRP, a reference MRP supports Provable only for the same brand, and unverified rows cap findings at Ask (SPEC D2, `assessDrugPrice()`).
