import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

// GET /api/sessions?clientId=xxx — get session logs for a client
export async function GET(req: NextRequest) {
  const clientId = req.nextUrl.searchParams.get("clientId");
  const programId = req.nextUrl.searchParams.get("programId");
  const limit = parseInt(req.nextUrl.searchParams.get("limit") ?? "20");

  const sessions = await prisma.sessionLog.findMany({
    where: {
      ...(clientId && { clientId }),
      ...(programId && { programId }),
    },
    include: {
      exerciseLogs: {
        include: {
          programExercise: {
            include: { exercise: { select: { name: true } } },
          },
          sets: { orderBy: { setNumber: "asc" } },
        },
      },
    },
    orderBy: { completedAt: "desc" },
    take: limit,
  });

  return NextResponse.json(sessions);
}

// POST /api/sessions — log a completed session (from client portal)
export async function POST(req: NextRequest) {
  const body = await req.json();
  const {
    clientId,
    programId,
    dayLabel,
    sessionRpe,
    feedback,
    startedAt,
    completedAt,
    exerciseLogs,
  } = body;

  if (!clientId || !programId || !dayLabel) {
    return NextResponse.json(
      { error: "clientId, programId, and dayLabel are required" },
      { status: 400 }
    );
  }

  const start = startedAt ? new Date(startedAt) : null;
  const end = completedAt ? new Date(completedAt) : new Date();
  const durationMin =
    start && end
      ? Math.round((end.getTime() - start.getTime()) / 60000)
      : null;

  const session = await prisma.sessionLog.create({
    data: {
      clientId,
      programId,
      dayLabel,
      sessionRpe: sessionRpe ?? null,
      feedback: feedback || null,
      startedAt: start,
      completedAt: end,
      durationMin,
      exerciseLogs: {
        create: (
          exerciseLogs as Array<{
            programExerciseId: string;
            sets: Array<{
              setNumber: number;
              repsCompleted?: number;
              loadUsed?: string;
              rpe?: number;
              notes?: string;
            }>;
          }>
        )?.map(
          (log: {
            programExerciseId: string;
            sets: Array<{
              setNumber: number;
              repsCompleted?: number;
              loadUsed?: string;
              rpe?: number;
              notes?: string;
            }>;
          }) => ({
            programExerciseId: log.programExerciseId,
            sets: {
              create: log.sets.map((s) => ({
                setNumber: s.setNumber,
                repsCompleted: s.repsCompleted ?? null,
                loadUsed: s.loadUsed ?? null,
                rpe: s.rpe ?? null,
                notes: s.notes ?? null,
              })),
            },
          })
        ) ?? [],
      },
    },
    include: {
      exerciseLogs: {
        include: {
          sets: { orderBy: { setNumber: "asc" } },
        },
      },
    },
  });

  return NextResponse.json(session, { status: 201 });
}
