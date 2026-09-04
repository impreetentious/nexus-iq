// Escalation second opinions: the run engine flags units (low confidence,
// panel entropy, schema repairs, atypical length) and calls the escalator the
// Director module hands it. The Director judges the unit independently under
// the same codebook; if it agrees with the worker the original output stands
// (null — and the ENGINE stamps escalatedBy: "director-concurred" on the
// written line, so a reviewed-and-confirmed verdict stays distinguishable
// from a unit nobody reviewed), if it disagrees it returns a replacement
// Output marked escalated: true whose rationale leads with a one-line reason
// the researcher can read in the escalation queue.
import { callDirector } from "./director.js";
import { escalationPrompt, escalationSchema } from "./prompts.js";

// Label equality, canonicalized the SAME way every other label comparison in
// the codebase is (runs/monitor.js labelKey, routes/_shared.js labelKey):
// multilabel labels are arrays and carry no meaningful order, so ["pay",
// "workload"] and ["workload", "pay"] are the SAME verdict. A raw
// JSON.stringify compare called that a disagreement and overwrote the
// worker's line with a reordered copy of itself — inflating
// run.escalation.count and stamping escalatedBy "director" (an override) on a
// unit the Director had actually concurred with. Scalars keep their existing
// strict behavior (5 and "5" stay distinct), matching labelKey exactly.
const labelKey = (v) =>
  Array.isArray(v) ? JSON.stringify([...v].map(String).sort()) : JSON.stringify(v);

const same = (a, b) => labelKey(a) === labelKey(b);

// makeEscalator(project, construct) → async (unit, output) → Output | null
export function makeEscalator(project, construct) {
  const schema = escalationSchema(construct);
  return async function escalate(unit, output) {
    const { system, user } = escalationPrompt({ construct, unit, output });
    let res;
    try {
      res = await callDirector(project, {
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
        schema,
        // reasoning-class Directors bill thinking tokens against max_tokens —
        // 512 (even doubled once by the truncation retry) starved them in the
        // field; ≥1536 covers thinking + the structured second opinion.
        maxTokens: 1536,
      });
    } catch (err) {
      // name the stage so the researcher knows WHICH Director call failed
      if (err instanceof Error) err.message = `Director second opinion: ${err.message}`;
      throw err;
    }
    const second = res.json;
    if (same(second.label, output.label)) return null; // worker's call stands

    const reason = String(second.reason ?? "").trim();
    return {
      unitId: unit.id ?? output.unitId,
      juror: "director",
      label: second.label,
      confidence: second.confidence,
      // one-line reason first — it is what the escalation queue shows —
      // followed by the Director's own grounded rationale
      rationale: reason ? `${reason} — ${second.rationale}` : second.rationale,
      escalated: true,
      // structural provenance: the engine keeps the WORKER's juror hash on
      // the written line (resume keys on it) but copies escalatedBy through,
      // so disagreement views can tell a Director override apart without
      // parsing rationale text.
      escalatedBy: "director",
    };
  };
}
