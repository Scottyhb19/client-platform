import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

const PRACTICE_ID = "default-practice"; // TODO: derive from auth session

// GET /api/exercises/:id
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  const exercise = await prisma.exercise.findFirst({
    where: { id, practiceId: PRACTICE_ID, deletedAt: null },
    include: { tags: { select: { id: true, name: true } } },
  });

  if (!exercise) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  return NextResponse.json(exercise);
}

// PATCH /api/exercises/:id — update exercise
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const body = await req.json();

  const {
    name,
    movementPattern,
    videoUrl,
    instructions,
    defaultSets,
    defaultReps,
    defaultRest,
    defaultRpe,
    defaultMetric,
    defaultLoad,
    tagIds,
  } = body;

  const exercise = await prisma.exercise.update({
    where: { id },
    data: {
      ...(name !== undefined && { name: name.trim() }),
      ...(movementPattern !== undefined && { movementPattern }),
      ...(videoUrl !== undefined && { videoUrl: videoUrl || null }),
      ...(instructions !== undefined && { instructions: instructions || null }),
      ...(defaultSets !== undefined && { defaultSets }),
      ...(defaultReps !== undefined && { defaultReps: defaultReps || null }),
      ...(defaultRest !== undefined && { defaultRest: defaultRest || null }),
      ...(defaultRpe !== undefined && { defaultRpe }),
      ...(defaultMetric !== undefined && { defaultMetric: defaultMetric || null }),
      ...(defaultLoad !== undefined && { defaultLoad: defaultLoad || null }),
      ...(tagIds !== undefined && {
        tags: { set: tagIds.map((tid: string) => ({ id: tid })) },
      }),
    },
    include: { tags: { select: { id: true, name: true } } },
  });

  return NextResponse.json(exercise);
}

// DELETE /api/exercises/:id — soft delete
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  await prisma.exercise.update({
    where: { id },
    data: { deletedAt: new Date() },
  });

  return NextResponse.json({ success: true });
}
