import { ClientProfile } from "@/components/clients/client-profile";

export default async function ClientProfilePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  return <ClientProfile clientId={id} />;
}
