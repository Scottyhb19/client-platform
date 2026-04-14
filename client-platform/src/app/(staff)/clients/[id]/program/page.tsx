import { ProgramCalendar } from "@/components/program-calendar/program-calendar";

export default async function ClientProgramPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id: clientId } = await params;

  // Fetch client and their active program server-side
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
  let clientName = "Client";
  let programId = "";

  try {
    const res = await fetch(`${baseUrl}/api/clients/${clientId}`, {
      cache: "no-store",
    });
    if (res.ok) {
      const client = await res.json();
      clientName = `${client.firstName} ${client.lastName}`;
      const activeProgram = client.programs?.find(
        (p: { status: string }) => p.status === "ACTIVE"
      );
      if (activeProgram) {
        programId = activeProgram.id;
      }
    }
  } catch {
    // Will show "no program" state
  }

  if (!programId) {
    return (
      <div className="text-sm text-[var(--color-slate)] py-8 text-center">
        No active program found for this client.
      </div>
    );
  }

  return (
    <ProgramCalendar
      programId={programId}
      clientId={clientId}
      clientName={clientName}
    />
  );
}
