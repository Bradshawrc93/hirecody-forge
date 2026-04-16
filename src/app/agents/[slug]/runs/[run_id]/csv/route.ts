import { NextResponse } from "next/server";
import { findAgentBySlug } from "@/lib/agent-lookup";
import { getRun } from "@/lib/obs";
import { getAgentKey } from "@/lib/kv";
import { parseCsvEnvelope } from "@/lib/csv-report";

export const dynamic = "force-dynamic";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ slug: string; run_id: string }> }
) {
  const { slug, run_id } = await params;

  const lean = await findAgentBySlug(slug);
  if (!lean) return new NextResponse("not found", { status: 404 });
  const apiKey = await getAgentKey(lean.app_id);
  if (!apiKey) return new NextResponse("not found", { status: 404 });

  const { run } = await getRun(run_id, apiKey);
  const envelope = parseCsvEnvelope(run.output ?? null);
  if (!envelope) {
    return new NextResponse("not a csv run", { status: 404 });
  }

  // Quote the filename to survive spaces or special chars, and escape any
  // embedded double-quotes. The filename is already slug-derived so this
  // mostly matters defensively.
  const safeName = envelope.filename.replace(/"/g, "");
  return new NextResponse(envelope.csv, {
    status: 200,
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="${safeName}"`,
      "cache-control": "no-store",
    },
  });
}
