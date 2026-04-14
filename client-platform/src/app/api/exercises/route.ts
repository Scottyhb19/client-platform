import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

const PRACTICE_ID = "default-practice"; // TODO: derive from auth session

// GET /api/exercises — list with optional search + filters
export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const search = searchParams.get("search") ?? "";
  const pattern = searchParams.get("pattern"); // MovementPattern enum value
  const tag = searchParams.get("tag");

  const exercises = await prisma.exercise.findMany({
    where: {
      practiceId: PRACTICE_ID,
      deletedAt: null,
      ...(search && {
        name: { contains: search, mode: "insensitive" },
      }),
      ...(pattern && {
        movementPattern: pattern as never,
      }),
      ...(tag && {
        tags: { some: { name: tag } },
      }),
    },
    include: {
      tags: { select: { id: true, name: true } },
    },
    orderBy: [{ usageCount: "desc" }, { name: "asc" }],
  });

  return NextResponse.json(exercises);
}

// POST /api/exercises — create new exercise
export async function POST(req: NextRequest) {
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

  if (!name?.trim()) {
    return NextResponse.json(
      { error: "Exercise name is required" },
      { status: 400 }
    );
  }

  const exercise = await prisma.exercise.create({
    data: {
      practiceId: PRACTICE_ID,
      name: name.trim(),
      movementPattern: movementPattern ?? "OTHER",
      videoUrl: videoUrl || null,
      instructions: instructions || null,
      defaultSets: defaultSets ?? null,
      defaultReps: defaultReps || null,
      defaultRest: defaultRest || null,
      defaultRpe: defaultRpe ?? null,
      defaultMetric: defaultMetric || null,
      defaultLoad: defaultLoad || null,
      ...(tagIds?.length && {
        tags: { connect: tagIds.map((id: string) => ({ id })) },
      }),
    },
    include: {
      tags: { select: { id: true, name: true } },
    },
  });

  return NextResponse.json(exercise, { status: 201 });
}
