import { Resend } from "resend";

// Lazy-initialize Resend so it doesn't throw during build when no API key is set
let _resend: Resend | null = null;
function getResend(): Resend | null {
  if (!process.env.RESEND_API_KEY) return null;
  if (!_resend) _resend = new Resend(process.env.RESEND_API_KEY);
  return _resend;
}

// Default sender — uses Resend's free onboarding domain until a custom domain is configured
const FROM_EMAIL = process.env.FROM_EMAIL || "Client Platform <onboarding@resend.dev>";
const PRACTICE_NAME = "Client Platform";

interface SendEmailOptions {
  to: string;
  subject: string;
  html: string;
  replyTo?: string;
}

export async function sendEmail({ to, subject, html, replyTo }: SendEmailOptions) {
  const resend = getResend();
  if (!resend) {
    console.warn("[Email] RESEND_API_KEY not set — skipping email send");
    console.log(`[Email] Would send to ${to}: ${subject}`);
    return { success: false, reason: "no_api_key" };
  }

  try {
    const { data, error } = await resend.emails.send({
      from: FROM_EMAIL,
      to,
      subject,
      html,
      replyTo: replyTo || undefined,
    });

    if (error) {
      console.error("[Email] Send failed:", error);
      return { success: false, reason: error.message };
    }

    console.log(`[Email] Sent to ${to}: ${subject} (id: ${data?.id})`);
    return { success: true, id: data?.id };
  } catch (err) {
    console.error("[Email] Unexpected error:", err);
    return { success: false, reason: "unexpected_error" };
  }
}

// ─── Email Templates ────────────────────────────────────────────────────────

export async function sendAppointmentConfirmation(
  to: string,
  clientName: string,
  date: string,
  time: string,
) {
  return sendEmail({
    to,
    subject: `Appointment Confirmed — ${date} at ${time}`,
    html: `
      <div style="font-family: 'Helvetica Neue', Arial, sans-serif; max-width: 500px; margin: 0 auto; padding: 32px 24px;">
        <h2 style="color: #0A5540; margin: 0 0 16px;">Appointment Confirmed</h2>
        <p style="color: #231F20; font-size: 15px; line-height: 1.6; margin: 0 0 12px;">
          Hi ${clientName},
        </p>
        <p style="color: #231F20; font-size: 15px; line-height: 1.6; margin: 0 0 20px;">
          Your appointment has been confirmed for:
        </p>
        <div style="background: #F0F4F2; border-radius: 10px; padding: 16px 20px; margin: 0 0 20px;">
          <p style="margin: 0; font-size: 15px; color: #231F20;">
            <strong>${date}</strong> at <strong>${time}</strong>
          </p>
        </div>
        <p style="color: #637062; font-size: 13px; line-height: 1.5; margin: 0;">
          If you need to reschedule, please get in touch.
        </p>
        <hr style="border: none; border-top: 1px solid #E2E8E4; margin: 24px 0 16px;" />
        <p style="color: #93998F; font-size: 12px; margin: 0;">${PRACTICE_NAME}</p>
      </div>
    `,
  });
}

export async function sendProgramAssigned(
  to: string,
  clientName: string,
  programName: string,
) {
  return sendEmail({
    to,
    subject: `New Program: ${programName}`,
    html: `
      <div style="font-family: 'Helvetica Neue', Arial, sans-serif; max-width: 500px; margin: 0 auto; padding: 32px 24px;">
        <h2 style="color: #0A5540; margin: 0 0 16px;">New Program Assigned</h2>
        <p style="color: #231F20; font-size: 15px; line-height: 1.6; margin: 0 0 12px;">
          Hi ${clientName},
        </p>
        <p style="color: #231F20; font-size: 15px; line-height: 1.6; margin: 0 0 20px;">
          A new program has been assigned to you:
        </p>
        <div style="background: #F0F4F2; border-radius: 10px; padding: 16px 20px; margin: 0 0 20px;">
          <p style="margin: 0; font-size: 16px; color: #231F20; font-weight: 600;">${programName}</p>
        </div>
        <p style="color: #231F20; font-size: 15px; line-height: 1.6; margin: 0 0 12px;">
          Log in to your portal to view your exercises and start training.
        </p>
        <hr style="border: none; border-top: 1px solid #E2E8E4; margin: 24px 0 16px;" />
        <p style="color: #93998F; font-size: 12px; margin: 0;">${PRACTICE_NAME}</p>
      </div>
    `,
  });
}

export async function sendSessionSummary(
  to: string,
  clientName: string,
  dayLabel: string,
  exerciseCount: number,
  sessionRpe: number | null,
  date: string,
) {
  return sendEmail({
    to,
    subject: `Session Complete — ${dayLabel}`,
    html: `
      <div style="font-family: 'Helvetica Neue', Arial, sans-serif; max-width: 500px; margin: 0 auto; padding: 32px 24px;">
        <h2 style="color: #0A5540; margin: 0 0 16px;">Session Complete</h2>
        <p style="color: #231F20; font-size: 15px; line-height: 1.6; margin: 0 0 20px;">
          Hi ${clientName}, nice work today.
        </p>
        <div style="background: #F0F4F2; border-radius: 10px; padding: 16px 20px; margin: 0 0 20px;">
          <p style="margin: 0 0 8px; font-size: 16px; color: #231F20; font-weight: 600;">${dayLabel} — ${date}</p>
          <p style="margin: 0; font-size: 14px; color: #637062;">
            ${exerciseCount} exercises completed${sessionRpe ? ` · Session RPE: ${sessionRpe}/10` : ""}
          </p>
        </div>
        <p style="color: #637062; font-size: 13px; line-height: 1.5; margin: 0;">
          Keep it up. Your next session is waiting in the portal.
        </p>
        <hr style="border: none; border-top: 1px solid #E2E8E4; margin: 24px 0 16px;" />
        <p style="color: #93998F; font-size: 12px; margin: 0;">${PRACTICE_NAME}</p>
      </div>
    `,
  });
}

export async function sendAppointmentReminder(
  to: string,
  clientName: string,
  date: string,
  time: string,
) {
  return sendEmail({
    to,
    subject: `Reminder: Appointment tomorrow at ${time}`,
    html: `
      <div style="font-family: 'Helvetica Neue', Arial, sans-serif; max-width: 500px; margin: 0 auto; padding: 32px 24px;">
        <h2 style="color: #0A5540; margin: 0 0 16px;">Appointment Reminder</h2>
        <p style="color: #231F20; font-size: 15px; line-height: 1.6; margin: 0 0 12px;">
          Hi ${clientName},
        </p>
        <p style="color: #231F20; font-size: 15px; line-height: 1.6; margin: 0 0 20px;">
          Just a reminder about your upcoming appointment:
        </p>
        <div style="background: #F0F4F2; border-radius: 10px; padding: 16px 20px; margin: 0 0 20px;">
          <p style="margin: 0; font-size: 15px; color: #231F20;">
            <strong>${date}</strong> at <strong>${time}</strong>
          </p>
        </div>
        <p style="color: #637062; font-size: 13px; line-height: 1.5; margin: 0;">
          If you need to reschedule, please get in touch as soon as possible.
        </p>
        <hr style="border: none; border-top: 1px solid #E2E8E4; margin: 24px 0 16px;" />
        <p style="color: #93998F; font-size: 12px; margin: 0;">${PRACTICE_NAME}</p>
      </div>
    `,
  });
}
