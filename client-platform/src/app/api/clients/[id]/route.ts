import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { toBookingDTO } from "@/lib/bookings";

const PRACTICE_ID = "default-practice";

// GET /api/clients/:id — full client profile
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  const client = await prisma.client.findFirst({
    where: { id, practiceId: PRACTICE_ID, deletedAt: null },
    include: {
      category: { select: { id: true, name: true } },
      practitioner: {
        select: { id: true, firstName: true, lastName: true },
      },
      programs: {
        where: { deletedAt: null },
        orderBy: { createdAt: "desc" },
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
      },
      clinicalNotes: {
        where: { deletedAt: null },
        orderBy: [{ isPinned: "desc" }, { createdAt: "desc" }],
        include: { author: { select: { firstName: true, lastName: true } } },
      },
      bookings: {
        where: { deletedAt: null },
        orderBy: { startTime: "desc" },
        take: 10,
        include: {
          client: { select: { firstName: true, lastName: true } },
        },
      },
    },
  });

  if (!client) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  return NextResponse.json({
    ...client,
    bookings: client.bookings.map((b) => toBookingDTO(b)),
  });
}

// PATCH /api/clients/:id — update client
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const body = await req.json();

  const updatable = [
    "firstName",
    "lastName",
    "email",
    "dateOfBirth",
    "phone",
    "gender",
    "address",
    "medicalHistory",
    "referralSource",
    "referredBy",
    "medications",
    "injuries",
    "contraindications",
    "goals",
    "categoryId",
    "isActive",
  ] as const;

  const data: Record<string, unknown> = {};
  for (const key of updatable) {
    if (body[key] !== undefined) {
      data[key] =
        key === "dateOfBirth" && body[key] ? new Date(body[key]) : body[key];
    }
  }

  const client = await prisma.client.update({
    where: { id },
    data,
    include: { category: { select: { id: true, name: true } } },
  });

  return NextResponse.json(client);
}

// DELETE /api/clients/:id — soft delete
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  await prisma.client.update({
    where: { id },
    data: { deletedAt: new Date(), isActive: false },
  });

  return NextResponse.json({ success: true });
}
