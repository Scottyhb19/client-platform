import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

// GET /api/notes?clientId=xxx — get notes for a client
export async function GET(req: NextRequest) {
  const clientId = req.nextUrl.searchParams.get("clientId");
  if (!clientId) {
    return NextResponse.json({ error: "clientId is required" }, { status: 400 });
  }

  const notes = await prisma.clinicalNote.findMany({
    where: { clientId, deletedAt: null },
    include: { author: { select: { firstName: true, lastName: true } } },
    orderBy: [{ isPinned: "desc" }, { createdAt: "desc" }],
  });

  return NextResponse.json(notes);
}

// POST /api/notes — create a clinical note
export async function POST(req: NextRequest) {
  const body = await req.json();
  const { clientId, authorId, type, title, content, isInjuryFlag } = body;

  if (!clientId || !authorId || !content?.trim()) {
    return NextResponse.json(
      { error: "clientId, authorId, and content are required" },
      { status: 400 }
    );
  }

  const note = await prisma.clinicalNote.create({
    data: {
      clientId,
      authorId,
      type: type ?? "GENERAL",
      title: title || null,
      content: content.trim(),
      isInjuryFlag: isInjuryFlag ?? false,
    },
    include: { author: { select: { firstName: true, lastName: true } } },
  });

  return NextResponse.json(note, { status: 201 });
}
