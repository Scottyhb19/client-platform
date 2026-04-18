import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import type { BookingStatus } from "@/generated/prisma/client";
import {
  dateTimeInZone,
  DEFAULT_TIMEZONE,
  toBookingDTO,
} from "@/lib/bookings";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  try {
    const booking = await prisma.booking.findFirst({
      where: { id, deletedAt: null },
      include: { client: { select: { firstName: true, lastName: true } } },
    });
    if (!booking) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    return NextResponse.json(toBookingDTO(booking));
  } catch (err) {
    console.error("GET /api/bookings/[id] failed:", err);
    return NextResponse.json(
      { error: "Failed to load booking" },
      { status: 500 }
    );
  }
}

// PATCH — update fields on a booking. Accepts any subset:
//   { startTime: ISO | "HH:MM", date: "YYYY-MM-DD", durationMinutes, clientId,
//     type, notes, status }
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  try {
    const body = await req.json();
    const data: Record<string, unknown> = {};

    if (body.clientId !== undefined) data.clientId = body.clientId;
    if (body.type !== undefined) data.type = body.type || null;
    if (body.notes !== undefined) data.notes = body.notes || null;
    if (body.status !== undefined) {
      data.status = body.status as BookingStatus;
      if (body.status === "CANCELLED" && !body.cancelledAt) {
        data.cancelledAt = new Date();
      }
    }
    if (body.cancelReason !== undefined) data.cancelReason = body.cancelReason;

    if (body.startTime !== undefined) {
      if (body.date && /^\d{2}:\d{2}$/.test(String(body.startTime))) {
        data.startTime = dateTimeInZone(
          body.date,
          body.startTime,
          DEFAULT_TIMEZONE
        );
      } else {
        const parsed = new Date(body.startTime);
        if (Number.isNaN(parsed.getTime())) {
          return NextResponse.json(
            { error: "Invalid startTime" },
            { status: 400 }
          );
        }
        data.startTime = parsed;
      }
    }

    if (body.durationMinutes !== undefined) {
      const n = Number(body.durationMinutes);
      if (!Number.isFinite(n) || n <= 0) {
        return NextResponse.json(
          { error: "durationMinutes must be a positive number" },
          { status: 400 }
        );
      }
      data.durationMinutes = n;
    } else if (
      body.endTime !== undefined &&
      body.date &&
      (data.startTime instanceof Date || body.startTime)
    ) {
      const start =
        data.startTime instanceof Date
          ? data.startTime
          : dateTimeInZone(body.date, body.startTime, DEFAULT_TIMEZONE);
      const end = dateTimeInZone(body.date, body.endTime, DEFAULT_TIMEZONE);
      const mins = Math.round((end.getTime() - start.getTime()) / 60_000);
      if (mins <= 0) {
        return NextResponse.json(
          { error: "endTime must be after startTime" },
          { status: 400 }
        );
      }
      data.durationMinutes = mins;
    }

    const booking = await prisma.booking.update({
      where: { id },
      data,
      include: { client: { select: { firstName: true, lastName: true } } },
    });

    return NextResponse.json(toBookingDTO(booking));
  } catch (err) {
    console.error("PATCH /api/bookings/[id] failed:", err);
    return NextResponse.json(
      { error: "Failed to update booking" },
      { status: 500 }
    );
  }
}

// DELETE — soft delete
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  try {
    await prisma.booking.update({
      where: { id },
      data: { deletedAt: new Date() },
    });
    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("DELETE /api/bookings/[id] failed:", err);
    return NextResponse.json(
      { error: "Failed to delete booking" },
      { status: 500 }
    );
  }
}
