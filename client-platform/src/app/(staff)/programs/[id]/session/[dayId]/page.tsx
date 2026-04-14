import { SessionBuilder } from "@/components/session-builder/session-builder";

export default async function SessionBuilderPage({
  params,
}: {
  params: Promise<{ id: string; dayId: string }>;
}) {
  const { id: programId, dayId } = await params;

  return <SessionBuilder programId={programId} dayId={dayId} />;
}
