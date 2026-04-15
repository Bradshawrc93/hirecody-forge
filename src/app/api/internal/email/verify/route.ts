import { NextResponse } from "next/server";
import { emailVerify, ObsError } from "@/lib/obs";

export async function POST(req: Request) {
  try {
    const { email, code } = (await req.json()) as { email?: string; code?: string };
    if (!email || !code) {
      return NextResponse.json({ error: "email and code required" }, { status: 400 });
    }
    const result = await emailVerify(email, code);
    return NextResponse.json(result);
  } catch (e) {
    if (e instanceof ObsError) {
      return NextResponse.json(e.body, { status: e.status });
    }
    return NextResponse.json({ error: "verify failed" }, { status: 500 });
  }
}
