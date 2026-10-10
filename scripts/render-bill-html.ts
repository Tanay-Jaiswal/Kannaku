// Re-renders the line-item table and totals block of each bill.html from bill.truth.json,
// so the printed sample bill can never drift from the truth data. The rest of the page is kept as is.
// Run: npx tsx scripts/render-bill-html.ts   (check-fixtures.ts fails if the HTML is stale)
import { readFileSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { BillExtraction } from "../src/lib/schemas";
import { SAMPLE_BILL_IDS } from "../src/lib/config";

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const inr = (n: number) =>
  "₹" + n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export function renderBillHtml(html: string, bill: BillExtraction): string {
  const rows = bill.items
    .map((i) => {
      const when = i.time ? `${i.date}<br><span class="sub">${i.time}</span>` : i.date;
      const qty = i.unit ? `${i.quantity} ${esc(i.unit)}` : `${i.quantity}`;
      return `<tr><td>${i.id}</td><td>${when}</td><td>${esc(i.description_raw)}</td>` +
        `<td class="num">${qty}</td><td class="num">${inr(i.unit_rate)}</td><td class="num">${inr(i.amount)}</td></tr>`;
    })
    .join("");
  const sum = Math.round(bill.items.reduce((a, i) => a + i.amount, 0) * 100) / 100;
  const totals =
    `<div class="total-wrap"><div><span>Line-item subtotal</span><b>${inr(bill.stated_subtotal ?? sum)}</b></div>` +
    `<div><span>Discount</span><b>${inr(bill.stated_discount ?? 0)}</b></div>` +
    `<div class="grand"><span>Total shown</span><span>${inr(bill.stated_total)}</span></div></div>`;
  const out = html
    .replace(/<tbody>[\s\S]*?<\/tbody>/, `<tbody>${rows}</tbody>`)
    .replace(/<div class="total-wrap">[\s\S]*?<\/div><\/div>/, totals);
  if (!out.includes(rows) || !out.includes(totals)) throw new Error("bill.html layout not recognised");
  return out;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  for (const dir of SAMPLE_BILL_IDS) {
    const base = `data/synthetic/${dir}`;
    const bill = BillExtraction.parse(JSON.parse(readFileSync(`${base}/bill.truth.json`, "utf8")));
    const before = readFileSync(`${base}/bill.html`, "utf8");
    const after = renderBillHtml(before, bill);
    writeFileSync(`${base}/bill.html`, after, "utf8");
    console.log(`${dir}: bill.html ${before === after ? "unchanged" : "updated"}`);
  }
}
