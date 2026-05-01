import { NextResponse } from "next/server";
import { getAgent, patchAgent, ObsError } from "@/lib/obs";
import { getAgentKey } from "@/lib/kv";
import { slugify } from "@/lib/format";

interface Body {
  app_id: string;
  display_name?: string;
  slug?: string;
}

export async function POST(req: Request) {
  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }
  if (!body.app_id) {
    return NextResponse.json({ error: "missing app_id" }, { status: 400 });
  }
  if (!body.display_name && !body.slug) {
    return NextResponse.json({ error: "nothing to rename" }, { status: 400 });
  }

  const apiKey = await getAgentKey(body.app_id);
  if (!apiKey) return NextResponse.json({ error: "no key" }, { status: 404 });

  const patch: { display_name?: string; slug?: string } = {};
  if (body.display_name) patch.display_name = body.display_name.trim();
  if (body.slug) patch.slug = slugify(body.slug.trim());

  try {
    await patchAgent(body.app_id, apiKey, patch);
    // Obs's PATCH endpoint may silently ignore fields it doesn't know about,
    // so re-fetch and confirm the change actually took effect. Without this
    // verification a successful HTTP response misleads about the rename.
    const post = await getAgent(body.app_id, apiKey);
    const slugOk = !patch.slug || post.app.slug === patch.slug;
    const nameOk = !patch.display_name || post.app.display_name === patch.display_name;
    return NextResponse.json({
      ok: slugOk && nameOk,
      observed: { slug: post.app.slug, display_name: post.app.display_name },
      requested: patch,
    });
  } catch (e) {
    if (e instanceof ObsError) {
      return NextResponse.json(e.body, { status: e.status });
    }
    return NextResponse.json({ error: "rename_failed", details: String(e) }, { status: 500 });
  }
}
