import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

// POST /api/programs/:id/days/:dayId/exercises — add exercise to a day
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; dayId: string }> }
) {
  const { dayId } = await params;
  const body = await req.json();
  const { exerciseId, sectionTitle, sets, reps, rest, rpe, metric, load, instructions } = body;

  if (!exerciseId) {
    return NextResponse.json({ error: "exerciseId is required" }, { status: 400 });
  }

  // Get the next sort order
  const lastExercise = await prisma.programExercise.findFirst({
    where: { dayGroupId: dayId },
    orderBy: { sortOrder: "desc" },
  });
  const sortOrder = (lastExercise?.sortOrder ?? -1) + 1;

  // If no prescription provided, inherit from exercise defaults
  const exercise = await prisma.exercise.findUnique({
    where: { id: exerciseId },
  });

  const programExercise = await prisma.programExercise.create({
    data: {
      dayGroupId: dayId,
      exerciseId,
      sortOrder,
      sectionTitle: sectionTitle ?? null,
      sets: sets ?? exercise?.defaultSets ?? null,
      reps: reps ?? exercise?.defaultReps ?? null,
      rest: rest ?? exercise?.defaultRest ?? null,
      rpe: rpe ?? exercise?.defaultRpe ?? null,
      metric: metric ?? exercise?.defaultMetric ?? null,
      load: load ?? exercise?.defaultLoad ?? null,
      instructions: instructions ?? exercise?.instructions ?? null,
    },
    include: {
      exercise: { select: { id: true, name: true, videoUrl: true } },
    },
  });

  // Increment usage count on the exercise
  await prisma.exercise.update({
    where: { id: exerciseId },
    data: { usageCount: { increment: 1 } },
  });

  return NextResponse.json(programExercise, { status: 201 });
}

// PATCH /api/programs/:id/days/:dayId/exercises — reorder or update exercises
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; dayId: string }> }
) {
  const body = await req.json();

  // Batch update: expects array of { id, sortOrder, supersetGroup?, ... }
  if (Array.isArray(body)) {
    const updates = body.map(
      (item: { id: string; sortOrder?: number; supersetGroup?: string | null }) =>
        prisma.programExercise.update({
          where: { id: item.id },
          data: {
            ...(item.sortOrder !== undefined && { sortOrder: item.sortOrder }),
            ...(item.supersetGroup !== undefined && {
              supersetGroup: item.supersetGroup,
            }),
          },
        })
    );
    await prisma.$transaction(updates);
    return NextResponse.json({ success: true });
  }

  // Single exercise update
  const { id: exerciseId, ...data } = body;
  const updated = await prisma.programExercise.update({
    where: { id: exerciseId },
    data,
    include: {
      exercise: { select: { id: true, name: true, videoUrl: true } },
    },
  });

  return NextResponse.json(updated);
}
