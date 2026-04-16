import { anthropic, BUILDER_MODEL } from "./anthropic";
import type { AgentPlan } from "./agent-plan";
import { isAgentPlan } from "./agent-plan";

export interface BuilderInput {
  display_name: string;
  description: string;
  success_criteria?: string | null;
  context_text?: string | null;
  needs_llm: boolean;
  model: string;
  input_type: "none" | "text" | "file" | "both";
  can_send_email: boolean;
  has_web_access: boolean;
  output_type: "text" | "file" | "email" | "notification" | "side-effect";
  verified_email?: string | null;
  user_feedback?: string | null;
  previous_plan?: AgentPlan | null;
}

const SYSTEM = `You are an agent designer for a lightweight automation platform. Given a user's plain-English description plus a structured form, produce a JSON "plan" that the execution engine will run.

The plan must use ONLY these step types:
- "llm": calls an LLM. Fields: name, prompt, optional output_var, optional max_tokens (default 1024).
- "web_fetch": HTTP GET to a public URL. Fields: name, url, optional output_var. Only allowed when has_web_access is true.
- "file_read": reads the user-provided input file. Fields: name, optional output_var. Only allowed when input_type is "file" or "both".
- "email": sends an email to the verified address. Fields: name, subject_template, body_template. Only allowed when can_send_email is true. The subject_template MUST be a short one-line string (under ~80 chars) — typically a literal title, optionally with {{input_text}} or a short variable. NEVER reference the long body/output variable in subject_template: email providers reject subjects containing newlines.
- "output": final markdown rendered for the user. Fields: name, template. Required.

Templates may reference prior step outputs via {{output_var}}, the user input as {{input_text}}, and the file contents as {{file_text}}.

Constraints:
- 1 to 5 steps total.
- Use the user's selected runtime model in the top-level "model" field.
- Always include an "output" step that renders the final result as markdown.
- If can_send_email is true, also include an "email" step that sends the same rendered markdown to the verified address (its body_template should reference the output step's result).
- Keep prompts concise and grounded in the success criteria.

Respond with ONLY a JSON object, no prose:
{
  "model": "<runtime model id>",
  "system_prompt": "<short system prompt for the agent>",
  "steps": [ ... ]
}`;

export async function buildAgentPlan(input: BuilderInput): Promise<{
  plan: AgentPlan;
  inputTokens: number;
  outputTokens: number;
  durationMs: number;
}> {
  const userPayload = {
    display_name: input.display_name,
    description: input.description,
    success_criteria: input.success_criteria ?? null,
    context_text: input.context_text ?? null,
    needs_llm: input.needs_llm,
    runtime_model: input.model,
    input_type: input.input_type,
    can_send_email: input.can_send_email,
    has_web_access: input.has_web_access,
    output_type: input.output_type,
    verified_email: input.verified_email ?? null,
    user_feedback: input.user_feedback ?? null,
  };

  const userMessage = input.user_feedback
    ? `This is a REBUILD attempt. The previous build did not meet the user's expectations.${
        input.previous_plan
          ? `\n\nHere is the exact plan you generated previously (so you can see what to change):\n\n\`\`\`json\n${JSON.stringify(
              input.previous_plan,
              null,
              2
            )}\n\`\`\``
          : ""
      }\n\nThe user's feedback on what was wrong:\n\n"""\n${input.user_feedback}\n"""\n\nGenerate a revised plan that directly addresses this feedback. Do not simply repeat the previous plan.\n\nOriginal request:\n\n${JSON.stringify(
        userPayload,
        null,
        2
      )}`
    : `Build an agent plan for this request:\n\n${JSON.stringify(
        userPayload,
        null,
        2
      )}`;

  const start = Date.now();
  const res = await anthropic().messages.create({
    model: BUILDER_MODEL,
    max_tokens: 2048,
    system: SYSTEM,
    messages: [{ role: "user", content: userMessage }],
  });
  const durationMs = Date.now() - start;

  const text = res.content
    .filter((b): b is { type: "text"; text: string } => b.type === "text")
    .map((b) => b.text)
    .join("");
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) throw new Error("builder: no JSON in response");
  const parsed = JSON.parse(match[0]);
  if (!isAgentPlan(parsed)) {
    throw new Error("builder: plan failed schema validation");
  }
  return {
    plan: parsed,
    inputTokens: res.usage.input_tokens,
    outputTokens: res.usage.output_tokens,
    durationMs,
  };
}
