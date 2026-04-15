// The structured plan produced by the builder LLM and consumed by the
// execution engine. Kept intentionally narrow so non-engineer visitors get
// predictable, debuggable agents.

export type PlanStep =
  | {
      type: "llm";
      name: string;
      prompt: string;
      output_var?: string;
      max_tokens?: number;
    }
  | {
      type: "web_fetch";
      name: string;
      url: string;
      output_var?: string;
    }
  | {
      type: "file_read";
      name: string;
      output_var?: string;
    }
  | {
      type: "email";
      name: string;
      subject_template: string;
      body_template: string;
    }
  | {
      type: "output";
      name: string;
      template: string;
    };

export interface AgentPlan {
  model: string;
  system_prompt: string;
  steps: PlanStep[];
}

export function isAgentPlan(v: unknown): v is AgentPlan {
  if (!v || typeof v !== "object") return false;
  const p = v as AgentPlan;
  return (
    typeof p.model === "string" &&
    typeof p.system_prompt === "string" &&
    Array.isArray(p.steps)
  );
}
