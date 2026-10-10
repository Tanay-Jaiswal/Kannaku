// Required on every screen that shows findings (project tone rules). Text is the fixed SPEC disclaimer.
import { DISCLAIMER } from "@/lib/config";

export function Disclaimer({ className = "" }: { className?: string }) {
  return <p className={className}>{DISCLAIMER}</p>;
}
