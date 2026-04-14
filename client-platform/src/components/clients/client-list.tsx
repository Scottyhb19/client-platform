"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { ClientForm } from "./client-form";

type Category = { id: string; name: string };
type ClientSummary = {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  isActive: boolean;
  category: Category | null;
  programs: { id: string; name: string; status: string }[];
  clinicalNotes: { id: string; title: string | null }[];
};

export function ClientList() {
  const [clients, setClients] = useState<ClientSummary[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [search, setSearch] = useState("");
  const [activeCategory, setActiveCategory] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [loading, setLoading] = useState(true);

  const fetchClients = useCallback(async () => {
    const params = new URLSearchParams();
    if (search) params.set("search", search);
    if (activeCategory) params.set("category", activeCategory);
    const res = await fetch(`/api/clients?${params}`);
    if (res.ok) setClients(await res.json());
    setLoading(false);
  }, [search, activeCategory]);

  useEffect(() => {
    fetch("/api/categories")
      .then((r) => r.json())
      .then(setCategories);
  }, []);

  useEffect(() => {
    const timer = setTimeout(fetchClients, 200);
    return () => clearTimeout(timer);
  }, [fetchClients]);

  return (
    <div>
      {/* Search */}
      <input
        type="text"
        placeholder="Search clients..."
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        className="mb-4 w-full rounded-lg border border-[var(--color-border)] bg-white px-4 py-2.5 text-sm text-[var(--color-charcoal)] placeholder-[var(--color-slate)] outline-none focus:border-[var(--color-primary)] focus:ring-1 focus:ring-[var(--color-primary)]"
      />

      {/* Category filters */}
      <div className="mb-5 flex flex-wrap gap-2">
        <button
          onClick={() => setActiveCategory(null)}
          className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
            !activeCategory
              ? "bg-[var(--color-primary)] text-white"
              : "bg-white text-[var(--color-slate)] border border-[var(--color-border)] hover:bg-[var(--color-bg)]"
          }`}
        >
          All
        </button>
        {categories.map((cat) => (
          <button
            key={cat.id}
            onClick={() =>
              setActiveCategory(activeCategory === cat.name ? null : cat.name)
            }
            className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
              activeCategory === cat.name
                ? "bg-[var(--color-primary)] text-white"
                : "bg-white text-[var(--color-slate)] border border-[var(--color-border)] hover:bg-[var(--color-bg)]"
            }`}
          >
            {cat.name}
          </button>
        ))}
      </div>

      {/* Client list */}
      {loading ? (
        <p className="text-sm text-[var(--color-slate)]">Loading...</p>
      ) : clients.length === 0 ? (
        <div className="rounded-xl border border-[var(--color-border)] bg-white p-8 text-center">
          <p className="text-[var(--color-slate)]">
            {search || activeCategory
              ? "No clients match your filters."
              : "No clients yet. Add your first one."}
          </p>
        </div>
      ) : (
        <div className="grid gap-2">
          {clients.map((client) => (
            <Link
              key={client.id}
              href={`/clients/${client.id}`}
              className="flex items-center gap-4 rounded-xl border border-[var(--color-border)] bg-white p-4 shadow-sm hover:border-[var(--color-primary)]/30 transition-colors"
            >
              {/* Initials avatar */}
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[var(--color-primary)] text-sm font-bold text-white">
                {client.firstName[0]}
                {client.lastName[0]}
              </div>

              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-semibold text-[var(--color-charcoal)]">
                    {client.firstName} {client.lastName}
                  </span>
                  {client.category && (
                    <span className="rounded-full bg-[var(--color-bg)] px-2 py-0.5 text-[10px] font-medium text-[var(--color-slate)]">
                      {client.category.name}
                    </span>
                  )}
                  {client.clinicalNotes.length > 0 && (
                    <span className="rounded-full bg-[var(--color-red)]/10 px-2 py-0.5 text-[10px] font-medium text-[var(--color-red)]">
                      {client.clinicalNotes.length} flag{client.clinicalNotes.length > 1 ? "s" : ""}
                    </span>
                  )}
                </div>
                <p className="text-xs text-[var(--color-slate)] truncate">
                  {client.programs[0]?.name ?? "No active program"} ·{" "}
                  {client.email}
                </p>
              </div>

              {/* Active indicator */}
              <div
                className={`h-2.5 w-2.5 shrink-0 rounded-full ${
                  client.isActive
                    ? "bg-[var(--color-accent)]"
                    : "bg-[var(--color-border)]"
                }`}
              />
            </Link>
          ))}
        </div>
      )}

      {/* Add client */}
      <button
        onClick={() => setShowForm(true)}
        className="mt-4 w-full rounded-xl border-2 border-dashed border-[var(--color-border)] bg-white py-3 text-sm font-medium text-[var(--color-primary)] hover:border-[var(--color-primary)] hover:bg-[var(--color-bg)] transition-colors"
      >
        + Add New Client
      </button>

      {showForm && (
        <ClientForm
          categories={categories}
          onClose={() => {
            setShowForm(false);
            fetchClients();
          }}
        />
      )}
    </div>
  );
}
