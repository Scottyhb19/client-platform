import { NextRequest, NextResponse } from "next/server";
import {
  sendAppointmentConfirmation,
  sendAppointmentReminder,
  sendProgramAssigned,
  sendSessionSummary,
} from "@/lib/notifications/email";
import {
  sendAppointmentReminderSms,
  sendSessionReminderSms,
} from "@/lib/notifications/sms";

type NotificationType =
  | "appointment_confirmation"
  | "appointment_reminder"
  | "program_assigned"
  | "session_summary"
  | "session_reminder";

// POST /api/notifications — send a notification
export async function POST(req: NextRequest) {
  const body = await req.json();
  const { type, email, phone, clientName, ...data } = body as {
    type: NotificationType;
    email?: string;
    phone?: string;
    clientName: string;
    [key: string]: unknown;
  };

  if (!type || !clientName) {
    return NextResponse.json(
      { error: "type and clientName are required" },
      { status: 400 }
    );
  }

  const results: { email?: unknown; sms?: unknown } = {};

  switch (type) {
    case "appointment_confirmation":
      if (email) {
        results.email = await sendAppointmentConfirmation(
          email,
          clientName,
          data.date as string,
          data.time as string,
        );
      }
      break;

    case "appointment_reminder":
      if (email) {
        results.email = await sendAppointmentReminder(
          email,
          clientName,
          data.date as string,
          data.time as string,
        );
      }
      if (phone) {
        results.sms = await sendAppointmentReminderSms(
          phone,
          clientName,
          data.date as string,
          data.time as string,
        );
      }
      break;

    case "program_assigned":
      if (email) {
        results.email = await sendProgramAssigned(
          email,
          clientName,
          data.programName as string,
        );
      }
      break;

    case "session_summary":
      if (email) {
        results.email = await sendSessionSummary(
          email,
          clientName,
          data.dayLabel as string,
          data.exerciseCount as number,
          (data.sessionRpe as number) ?? null,
          data.date as string,
        );
      }
      break;

    case "session_reminder":
      if (phone) {
        results.sms = await sendSessionReminderSms(
          phone,
          clientName,
          data.dayLabel as string,
        );
      }
      break;

    default:
      return NextResponse.json(
        { error: `Unknown notification type: ${type}` },
        { status: 400 }
      );
  }

  return NextResponse.json({ success: true, results });
}
