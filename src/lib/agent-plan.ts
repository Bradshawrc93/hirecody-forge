// The structured plan produced by the builder LLM and consumed by the
// execution engine. Kept intentionally narrow so non-engineer visitors get
// predictable, debuggable agents.

import type { InputConfig } from "@/components/CreateFlow/types";

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
    }
  | {
      type: "html_report";
      name: string;
      template: string;
    }
  | {
      type: "csv_report";
      name: string;
      template: string;
    };

export interface AgentPlan {
  model: string;
  system_prompt: string;
  steps: PlanStep[];
  // Optional — present on plans built after multi-file support shipped so
  // the run dialog can render the creator's slot labels. Older plans fall
  // back to the legacy input_type mapping.
  input_config?: InputConfig;
  // Forge-level output_type, including values Obs doesn't know about
  // yet ("html_report", "csv"). Obs receives a mapped-down value on
  // agent creation, so this is the source of truth for rebuild/clone.
  output_type?:
    | "text"
    | "file"
    | "email"
    | "notification"
    | "html_report"
    | "csv"
    | "side-effect";
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

export function planProducesHtmlReport(plan: AgentPlan): boolean {
  return plan.steps.some((s) => s.type === "html_report");
}

export function planProducesCsvReport(plan: AgentPlan): boolean {
  return plan.steps.some((s) => s.type === "csv_report");
}
