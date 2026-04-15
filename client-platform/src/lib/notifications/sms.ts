// SMS notifications via Twilio
// Currently disabled — wired up and ready to go when Twilio keys are added.
// Set TWILIO_ENABLED=true in .env to activate.

interface SendSmsOptions {
  to: string; // E.164 format: +61412345678
  body: string;
}

export async function sendSms({ to, body }: SendSmsOptions) {
  const enabled = process.env.TWILIO_ENABLED === "true";
  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  const fromNumber = process.env.TWILIO_PHONE_NUMBER;

  if (!enabled) {
    console.log(`[SMS] Disabled — would send to ${to}: ${body}`);
    return { success: false, reason: "disabled" };
  }

  if (!accountSid || !authToken || !fromNumber) {
    console.warn("[SMS] Twilio credentials not configured — skipping");
    return { success: false, reason: "no_credentials" };
  }

  try {
    // Use Twilio REST API directly to avoid adding the full SDK
    const url = `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`;
    const auth = Buffer.from(`${accountSid}:${authToken}`).toString("base64");

    const res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Basic ${auth}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        To: to,
        From: fromNumber,
        Body: body,
      }),
    });

    if (!res.ok) {
      const error = await res.text();
      console.error("[SMS] Send failed:", error);
      return { success: false, reason: error };
    }

    const data = await res.json();
    console.log(`[SMS] Sent to ${to} (sid: ${data.sid})`);
    return { success: true, sid: data.sid };
  } catch (err) {
    console.error("[SMS] Unexpected error:", err);
    return { success: false, reason: "unexpected_error" };
  }
}

// ─── SMS Templates ──────────────────────────────────────────────────────────

export async function sendAppointmentReminderSms(
  to: string,
  clientName: string,
  date: string,
  time: string,
) {
  return sendSms({
    to,
    body: `Hi ${clientName}, reminder: you have an appointment on ${date} at ${time}. Reply to reschedule.`,
  });
}

export async function sendSessionReminderSms(
  to: string,
  clientName: string,
  dayLabel: string,
) {
  return sendSms({
    to,
    body: `Hi ${clientName}, your ${dayLabel} session is ready in the portal. Let's get after it.`,
  });
}
