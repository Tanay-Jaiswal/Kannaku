// Required on every screen that shows findings (project tone rules). Text is the fixed SPEC disclaimer.
import { DISCLAIMER } from "@/lib/config";

export function Disclaimer() {
  return <p className="text-xs text-slate-500">{DISCLAIMER}</p>;
}
