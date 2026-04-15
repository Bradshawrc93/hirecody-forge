import { haikuJSON } from "./anthropic";
import type { RunStep } from "./obs";

const SYSTEM = `You are a debugger explaining a failed agent run to a non-technical user. Given a step trace, write ONE short sentence (no jargon) describing what went wrong in plain English.

Respond with ONLY a JSON object:
{ "summary": "<one sentence>" }`;

export async function explainFailure(
  steps: RunStep[],
  errorMessage?: string | null
): Promise<string> {
  const trace = steps
    .map(
      (s) =>
        `${s.step_name} [${s.service}] → ${s.event_type}${
          s.metadata ? ` ${JSON.stringify(s.metadata).slice(0, 200)}` : ""
        }`
    )
    .join("\n");
  const payload = `Error: ${errorMessage ?? "(none)"}\n\nTrace:\n${trace}`;
  try {
    const { data } = await haikuJSON<{ summary: string }>(SYSTEM, payload);
    return data.summary;
  } catch {
    return errorMessage ?? "The run failed for an unknown reason.";
  }
}
