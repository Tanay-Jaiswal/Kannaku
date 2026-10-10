// How complete an audit result is, and who wrote its AI-stage answers. Pure and browser-safe: the results
// page, the tests and anything else that labels a result use this one function, so "complete" can never be
// shown for a result where a required stage did not run.
import { DEMO_MODEL } from "./config";
import type { Finding, PipelineResult } from "./schemas";

export type ReviewSource = NonNullable<PipelineResult["review_source"]>;

export const REVIEW_SOURCE_LABEL: Record<ReviewSource, { badge: string; text: string }> = {
  live_ai: { badge: "Live AI review", text: "The AI stages ran live on these documents." },
  recorded_ai: {
    badge: "Recorded AI review",
    text: "The AI stages were run once in advance on this synthetic sample and are replayed from saved, re-validated answers. No AI model was called for this run.",
  },
  demonstration: {
    badge: "Precomputed demonstration",
    text: "No AI model ran. Medicine-name matching, the discharge-summary comparison and the Auditor, Defender and Judge text were written in advance from this synthetic sample's verified answer key, then passed through the same checks as live AI output. Every rupee amount was computed by code on this run.",
  },
};

/** True when this finding's cross-examination came from the demonstration script, not an AI model. */
export const isDemoFinding = (f: Pick<Finding, "debate_log">) => f.debate_log.length > 0 && f.debate_log.every((l) => l.model === DEMO_MODEL);

export function auditStatus(result: PipelineResult) {
  const notDebated = result.findings.filter((f) => f.review?.state !== "debated").length;
  const q = result.bill.extraction_quality;
  const limitations = [
    ...(result.warnings ?? []),
    // A missing clinical check is a stage that did not run, not a pass.
    ...(!result.clinical_check
      ? ["The comparison with the discharge summary did not report a result."]
      : result.clinical_check.state === "failed" ? [result.clinical_check.note] : []),
    ...(notDebated ? [`${notDebated} finding(s) were not cross-examined by the Auditor/Defender/Judge review; they are shown at their rule tier.`] : []),
    ...(q?.excluded_lines.length ? [`${q.excluded_lines.length} bill line(s) could not be read and were not checked: ${q.excluded_lines.map((x) => `#${x.position} (${x.reason})`).join(", ")}.`] : []),
    ...result.bill.extraction_notes.filter((n) => !/^Synthetic data/i.test(n)),
  ];
  const source: ReviewSource = result.review_source ?? (result.data_label === "User upload" ? "live_ai" : "recorded_ai");
  return { complete: limitations.length === 0, limitations, notDebated, source, demonstration: source === "demonstration" };
}
