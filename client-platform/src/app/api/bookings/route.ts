import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  DEFAULT_TIMEZONE,
  dateTimeInZone,
  toBookingDTO,
} from "@/lib/bookings";

const PLACEHOLDER_USER = "placeholder-user";

// GET /api/bookings — list bookings with filters
// Query params:
//   - date=YYYY-MM-DD        → bookings for that calendar day (in practice tz)
//   - from=YYYY-MM-DD        → range start (inclusive)
//   - to=YYYY-MM-DD          → range end (exclusive)
//   - clientId=<id>
//   - status=<BookingStatus>
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = req.nextUrl;
    const clientId = searchParams.get("clientId");
    const date = searchParams.get("date");
    const from = searchParams.get("from");
    const to = searchParams.get("to");
    const status = searchParams.get("status");

    const tz = DEFAULT_TIMEZONE;

    let startFilter: Date | undefined;
    let endFilter: Date | undefined;

    if (date) {
      startFilter = dateTimeInZone(date, "00:00", tz);
      const next = new Date(startFilter);
      next.setUTCDate(next.getUTCDate() + 1);
      endFilter = next;
    } else if (from || to) {
      if (from) startFilter = dateTimeInZone(from, "00:00", tz);
      if (to) endFilter = dateTimeInZone(to, "00:00", tz);
    }

    const bookings = await prisma.booking.findMany({
      where: {
        deletedAt: null,
        ...(clientId && { clientId }),
        ...(status && { status: status as never }),
        ...((startFilter || endFilter) && {
          startTime: {
            ...(startFilter && { gte: startFilter }),
            ...(endFilter && { lt: endFilter }),
          },
        }),
      },
      include: {
        client: { select: { firstName: true, lastName: true } },
      },
      orderBy: [{ startTime: "asc" }],
    });

    return NextResponse.json(bookings.map((b) => toBookingDTO(b, tz)));
  } catch (err) {
    console.error("GET /api/bookings failed:", err);
    return NextResponse.json(
      { error: "Failed to load bookings" },
      { status: 500 }
    );
  }
}

// POST /api/bookings — create a booking
// Accepts either canonical shape or legacy shape:
//   canonical: { clientId, startTime: ISO, durationMinutes, type?, notes? }
//   legacy:    { clientId, date, startTime: "HH:MM", endTime: "HH:MM", type?, notes? }
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { clientId, type, notes } = body;

    if (!clientId) {
      return NextResponse.json(
        { error: "clientId is required" },
        { status: 400 }
      );
    }

    let startTime: Date;
    let durationMinutes: number;

    if (body.durationMinutes && body.startTime) {
      // Canonical shape
      startTime = new Date(body.startTime);
      durationMinutes = Number(body.durationMinutes);
      if (Number.isNaN(startTime.getTime()) || !durationMinutes) {
        return NextResponse.json(
          { error: "Invalid startTime or durationMinutes" },
          { status: 400 }
        );
      }
    } else if (body.date && body.startTime && body.endTime) {
      // Legacy shape — compute duration from start/end HH:MM strings
      startTime = dateTimeInZone(body.date, body.startTime);
      const endAt = dateTimeInZone(body.date, body.endTime);
      durationMinutes = Math.round(
        (endAt.getTime() - startTime.getTime()) / 60_000
      );
      if (durationMinutes <= 0) {
        return NextResponse.json(
          { error: "endTime must be after startTime" },
          { status: 400 }
        );
      }
    } else {
      return NextResponse.json(
        {
          error:
            "Provide either { startTime: ISO, durationMinutes } or { date, startTime: HH:MM, endTime: HH:MM }",
        },
        { status: 400 }
      );
    }

    const booking = await prisma.booking.create({
      data: {
        clientId,
        practitionerId: PLACEHOLDER_USER,
        startTime,
        durationMinutes,
        type: type || null,
        notes: notes || null,
      },
      include: {
        client: { select: { firstName: true, lastName: true } },
      },
    });

    return NextResponse.json(toBookingDTO(booking), { status: 201 });
  } catch (err) {
    console.error("POST /api/bookings failed:", err);
    return NextResponse.json(
      { error: "Failed to create booking" },
      { status: 500 }
    );
  }
}
