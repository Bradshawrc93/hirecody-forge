import { NextResponse } from "next/server";
import { safetyCheck } from "@/lib/guardrail";

export async function POST(req: Request) {
  try {
    const { display_name, description } = (await req.json()) as {
      display_name?: string;
      description?: string;
    };
    if (!display_name || !description) {
      return NextResponse.json(
        { error: "display_name and description required" },
        { status: 400 }
      );
    }
    const result = await safetyCheck(display_name, description);
    return NextResponse.json(result);
  } catch (e) {
    return NextResponse.json(
      { error: "safety check failed", details: String(e) },
      { status: 500 }
    );
  }
}
