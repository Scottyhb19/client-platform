import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

const PRACTICE_ID = "default-practice";
const PLACEHOLDER_USER = "placeholder-user"; // TODO: from auth

// GET /api/programs?clientId=xxx — list programs for a client
export async function GET(req: NextRequest) {
  const clientId = req.nextUrl.searchParams.get("clientId");

  const programs = await prisma.program.findMany({
    where: {
      deletedAt: null,
      ...(clientId && { clientId }),
      ...(!clientId && {
        client: { practiceId: PRACTICE_ID },
      }),
    },
    include: {
      client: { select: { firstName: true, lastName: true } },
      days: {
        orderBy: { sortOrder: "asc" },
        include: {
          exercises: {
            orderBy: { sortOrder: "asc" },
            include: {
              exercise: {
                select: {
                  id: true,
                  name: true,
                  videoUrl: true,
                  instructions: true,
                  defaultSets: true,
                  defaultReps: true,
                  defaultRest: true,
                  defaultRpe: true,
                  defaultMetric: true,
                  defaultLoad: true,
                },
              },
            },
          },
        },
      },
    },
    orderBy: { createdAt: "desc" },
  });

  return NextResponse.json(programs);
}

// POST /api/programs — create a new program (from scratch or from template)
export async function POST(req: NextRequest) {
  const body = await req.json();
  const { clientId, name, type, templateId, startDate, mesocycleWeeks } = body;

  if (!clientId || !name?.trim()) {
    return NextResponse.json(
      { error: "clientId and name are required" },
      { status: 400 }
    );
  }

  // If cloning from a template, copy its structure
  if (templateId) {
    const template = await prisma.programTemplate.findUnique({
      where: { id: templateId },
      include: {
        days: {
          orderBy: { sortOrder: "asc" },
          include: {
            exercises: {
              orderBy: { sortOrder: "asc" },
            },
          },
        },
      },
    });

    if (!template) {
      return NextResponse.json(
        { error: "Template not found" },
        { status: 404 }
      );
    }

    const program = await prisma.program.create({
      data: {
        clientId,
        createdById: PLACEHOLDER_USER,
        templateId,
        name: name.trim(),
        type: type ?? "HOME_GYM",
        startDate: startDate ? new Date(startDate) : new Date(),
        mesocycleWeeks: mesocycleWeeks ?? null,
        days: {
          create: template.days.map((day) => ({
            label: day.label,
            sortOrder: day.sortOrder,
            exercises: {
              create: day.exercises.map((te) => ({
                exerciseId: te.exerciseId,
                sortOrder: te.sortOrder,
                sectionTitle: te.sectionTitle,
                sets: te.sets,
                reps: te.reps,
                rest: te.rest,
                rpe: te.rpe,
                metric: te.metric,
                load: te.load,
                instructions: te.instructions,
                supersetGroup: te.supersetGroup,
              })),
            },
          })),
        },
      },
      include: {
        days: {
          orderBy: { sortOrder: "asc" },
          include: {
            exercises: {
              orderBy: { sortOrder: "asc" },
              include: { exercise: { select: { name: true } } },
            },
          },
        },
      },
    });

    return NextResponse.json(program, { status: 201 });
  }

  // Create empty program
  const program = await prisma.program.create({
    data: {
      clientId,
      createdById: PLACEHOLDER_USER,
      name: name.trim(),
      type: type ?? "HOME_GYM",
      startDate: startDate ? new Date(startDate) : new Date(),
      mesocycleWeeks: mesocycleWeeks ?? null,
      days: {
        create: [
          { label: "Day A", sortOrder: 0 },
          { label: "Day B", sortOrder: 1 },
          { label: "Day C", sortOrder: 2 },
        ],
      },
    },
    include: {
      days: {
        orderBy: { sortOrder: "asc" },
        include: {
          exercises: {
            orderBy: { sortOrder: "asc" },
            include: { exercise: { select: { name: true } } },
          },
        },
      },
    },
  });

  return NextResponse.json(program, { status: 201 });
}
