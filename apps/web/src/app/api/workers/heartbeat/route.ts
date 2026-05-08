import { verifyQStashRequest } from "@/lib/qstash";
import { NextResponse } from "next/server";

export async function POST(request: Request) {
  const bodyText = await request.text();
  const ok = await verifyQStashRequest(request, bodyText);
  if (!ok) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  return NextResponse.json({ ok: true, at: new Date().toISOString() });
}
