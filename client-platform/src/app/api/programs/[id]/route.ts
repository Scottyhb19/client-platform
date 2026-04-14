import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

// GET /api/programs/:id — full program with days and exercises
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  const program = await prisma.program.findFirst({
    where: { id, deletedAt: null },
    include: {
      client: { select: { id: true, firstName: true, lastName: true } },
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
  });

  if (!program) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  return NextResponse.json(program);
}

// PATCH /api/programs/:id — update program metadata
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const body = await req.json();

  const program = await prisma.program.update({
    where: { id },
    data: {
      ...(body.name !== undefined && { name: body.name }),
      ...(body.type !== undefined && { type: body.type }),
      ...(body.status !== undefined && { status: body.status }),
      ...(body.startDate !== undefined && {
        startDate: body.startDate ? new Date(body.startDate) : null,
      }),
      ...(body.mesocycleWeeks !== undefined && {
        mesocycleWeeks: body.mesocycleWeeks,
      }),
      ...(body.notes !== undefined && { notes: body.notes }),
    },
  });

  return NextResponse.json(program);
}

// DELETE /api/programs/:id — soft delete
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  await prisma.program.update({
    where: { id },
    data: { deletedAt: new Date(), status: "ARCHIVED" },
  });

  return NextResponse.json({ success: true });
}
