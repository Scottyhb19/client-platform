import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

const PLACEHOLDER_USER = "placeholder-user";

// GET /api/bookings — list bookings with filters
export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const clientId = searchParams.get("clientId");
  const date = searchParams.get("date"); // YYYY-MM-DD
  const status = searchParams.get("status");

  const bookings = await prisma.booking.findMany({
    where: {
      deletedAt: null,
      ...(clientId && { clientId }),
      ...(date && {
        date: {
          gte: new Date(`${date}T00:00:00`),
          lt: new Date(`${date}T23:59:59`),
        },
      }),
      ...(status && { status: status as never }),
    },
    include: {
      client: { select: { firstName: true, lastName: true } },
      practitioner: { select: { firstName: true, lastName: true } },
    },
    orderBy: [{ date: "asc" }, { startTime: "asc" }],
  });

  return NextResponse.json(bookings);
}

// POST /api/bookings — create a booking
export async function POST(req: NextRequest) {
  const body = await req.json();
  const { clientId, date, startTime, endTime, type, notes } = body;

  if (!clientId || !date || !startTime || !endTime) {
    return NextResponse.json(
      { error: "clientId, date, startTime, and endTime are required" },
      { status: 400 }
    );
  }

  const booking = await prisma.booking.create({
    data: {
      clientId,
      practitionerId: PLACEHOLDER_USER,
      date: new Date(date),
      startTime,
      endTime,
      type: type || null,
      notes: notes || null,
    },
    include: {
      client: { select: { firstName: true, lastName: true } },
    },
  });

  return NextResponse.json(booking, { status: 201 });
}
