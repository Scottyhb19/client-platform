import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

// PATCH /api/notes/:id — update a clinical note
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const body = await req.json();

  const note = await prisma.clinicalNote.update({
    where: { id },
    data: {
      ...(body.type !== undefined && { type: body.type }),
      ...(body.title !== undefined && { title: body.title || null }),
      ...(body.content !== undefined && { content: body.content }),
      ...(body.isInjuryFlag !== undefined && { isInjuryFlag: body.isInjuryFlag }),
      ...(body.isPinned !== undefined && { isPinned: body.isPinned }),
      ...(body.flagReviewedAt !== undefined && {
        flagReviewedAt: body.flagReviewedAt ? new Date(body.flagReviewedAt) : null,
      }),
    },
    include: { author: { select: { firstName: true, lastName: true } } },
  });

  return NextResponse.json(note);
}

// DELETE /api/notes/:id — soft delete a note
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  await prisma.clinicalNote.update({
    where: { id },
    data: { deletedAt: new Date() },
  });

  return NextResponse.json({ success: true });
}
