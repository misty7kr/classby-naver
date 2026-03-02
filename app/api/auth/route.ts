import { NextResponse } from "next/server";
import crypto from "crypto";

export const runtime = "nodejs";

function expectedToken(secret: string) {
  return crypto.createHmac("sha256", secret).update("cb_auth_v1").digest("hex");
}

export async function POST(req: Request) {
  const secret = process.env.CLASSBY_ACCESS_PASSWORD;
  if (!secret) {
    return NextResponse.json(
      { error: "Server is missing CLASSBY_ACCESS_PASSWORD" },
      { status: 500 }
    );
  }

  const body = await req.json().catch(() => ({}));
  const password = String((body as any)?.password ?? "");

  if (password !== secret) {
    return NextResponse.json({ ok: false, error: "Invalid password" }, { status: 401 });
  }

  const res = NextResponse.json({ ok: true });
  res.cookies.set("cb_auth", expectedToken(secret), {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 30,
  });
  return res;
}

export async function DELETE() {
  const res = NextResponse.json({ ok: true });
  res.cookies.set("cb_auth", "", { path: "/", maxAge: 0 });
  return res;
}