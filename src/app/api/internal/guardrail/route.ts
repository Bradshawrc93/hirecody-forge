import { NextResponse } from "next/server";
import { complexityCheck } from "@/lib/guardrail";

export async function POST(req: Request) {
  try {
    const { description } = (await req.json()) as { description?: string };
    if (!description || description.trim().length < 5) {
      return NextResponse.json({ error: "description required" }, { status: 400 });
    }
    const result = await complexityCheck(description);
    return NextResponse.json(result);
  } catch (e) {
    return NextResponse.json(
      { error: "guardrail failed", details: String(e) },
      { status: 500 }
    );
  }
}
