import { NextResponse } from "next/server";
import { emailSend, ObsError } from "@/lib/obs";

export async function POST(req: Request) {
  try {
    const { email } = (await req.json()) as { email?: string };
    if (!email) return NextResponse.json({ error: "email required" }, { status: 400 });
    const result = await emailSend(email);
    return NextResponse.json(result);
  } catch (e) {
    if (e instanceof ObsError) {
      return NextResponse.json(e.body, { status: e.status });
    }
    return NextResponse.json({ error: "send failed" }, { status: 500 });
  }
}
