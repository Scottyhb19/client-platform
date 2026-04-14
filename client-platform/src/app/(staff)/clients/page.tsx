import { ClientList } from "@/components/clients/client-list";

export default function ClientsPage() {
  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-[var(--color-charcoal)] font-[family-name:var(--font-display)]">
          Clients
        </h1>
      </div>
      <ClientList />
    </div>
  );
}
