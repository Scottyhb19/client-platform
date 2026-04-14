"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { ClinicalNotes } from "./clinical-notes";

type ClientData = {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  phone: string | null;
  dateOfBirth: string | null;
  gender: string | null;
  address: string | null;
  medicalHistory: string | null;
  referralSource: string | null;
  referredBy: string | null;
  medications: string | null;
  injuries: string | null;
  contraindications: string | null;
  goals: string | null;
  isActive: boolean;
  category: { id: string; name: string } | null;
  practitioner: { id: string; firstName: string; lastName: string } | null;
  programs: Array<{
    id: string;
    name: string;
    type: string;
    status: string;
    days: Array<{
      label: string;
      exercises: Array<{ exercise: { name: string } }>;
    }>;
  }>;
  clinicalNotes: Array<{
    id: string;
    type: string;
    title: string | null;
    content: string;
    isInjuryFlag: boolean;
    isPinned: boolean;
    createdAt: string;
    author: { firstName: string; lastName: string };
  }>;
  bookings: Array<{
    id: string;
    date: string;
    startTime: string;
    endTime: string;
    status: string;
    type: string | null;
  }>;
};

const tabs = ["Profile", "Program", "Reports", "Bookings", "Comms"] as const;
type Tab = (typeof tabs)[number];

export function ClientProfile({ clientId }: { clientId: string }) {
  const [client, setClient] = useState<ClientData | null>(null);
  const [activeTab, setActiveTab] = useState<Tab>("Profile");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch(`/api/clients/${clientId}`)
      .then((r) => r.json())
      .then((data) => {
        setClient(data);
        setLoading(false);
      });
  }, [clientId]);

  if (loading) {
    return <p className="text-sm text-[var(--color-slate)]">Loading...</p>;
  }

  if (!client) {
    return <p className="text-sm text-[var(--color-red)]">Client not found.</p>;
  }

  return (
    <div>
      {/* Header */}
      <div className="mb-6 flex items-center gap-4">
        <Link
          href="/clients"
          className="rounded-lg p-1.5 text-[var(--color-slate)] hover:bg-[var(--color-bg)]"
        >
          <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5L8.25 12l7.5-7.5" />
          </svg>
        </Link>
        <div className="flex h-12 w-12 items-center justify-center rounded-full bg-[var(--color-primary)] text-lg font-bold text-white">
          {client.firstName[0]}
          {client.lastName[0]}
        </div>
        <div>
          <h1 className="text-xl font-bold text-[var(--color-charcoal)] font-[family-name:var(--font-display)]">
            {client.firstName} {client.lastName}
          </h1>
          <div className="flex items-center gap-2 text-xs text-[var(--color-slate)]">
            {client.category && (
              <span className="rounded-full bg-[var(--color-bg)] px-2 py-0.5 font-medium">
                {client.category.name}
              </span>
            )}
            <span
              className={`rounded-full px-2 py-0.5 font-medium ${
                client.isActive
                  ? "bg-[var(--color-accent)]/10 text-[var(--color-accent)]"
                  : "bg-[var(--color-border)] text-[var(--color-slate)]"
              }`}
            >
              {client.isActive ? "Active" : "Inactive"}
            </span>
          </div>
        </div>
      </div>

      {/* Tab navigation — inline, not separate pages */}
      <div className="mb-6 flex gap-1 border-b border-[var(--color-border)]">
        {tabs.map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`px-4 py-2.5 text-sm font-medium transition-colors border-b-2 -mb-px ${
              activeTab === tab
                ? "border-[var(--color-primary)] text-[var(--color-primary)]"
                : "border-transparent text-[var(--color-slate)] hover:text-[var(--color-charcoal)]"
            }`}
          >
            {tab}
          </button>
        ))}
      </div>

      {/* Tab content */}
      {activeTab === "Profile" && <ProfileTab client={client} />}
      {activeTab === "Program" && <ProgramTab client={client} />}
      {activeTab === "Reports" && <PlaceholderTab label="Reports" />}
      {activeTab === "Bookings" && <BookingsTab client={client} />}
      {activeTab === "Comms" && <PlaceholderTab label="Communications" />}
    </div>
  );
}

function ProfileTab({ client }: { client: ClientData }) {
  const fields = [
    { label: "Email", value: client.email },
    { label: "Phone", value: client.phone },
    {
      label: "Date of Birth",
      value: client.dateOfBirth
        ? new Date(client.dateOfBirth).toLocaleDateString("en-AU")
        : null,
    },
    { label: "Gender", value: client.gender },
    { label: "Address", value: client.address },
    { label: "Referral Source", value: client.referralSource },
    { label: "Referred By", value: client.referredBy },
  ];

  const clinicalFields = [
    { label: "Medical History", value: client.medicalHistory },
    { label: "Medications", value: client.medications },
    { label: "Injuries", value: client.injuries },
    { label: "Contraindications", value: client.contraindications },
    { label: "Goals", value: client.goals },
  ];

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      {/* Personal Details */}
      <div className="rounded-xl border border-[var(--color-border)] bg-white p-5">
        <h3 className="mb-3 text-sm font-semibold text-[var(--color-charcoal)]">
          Personal Details
        </h3>
        <dl className="space-y-2">
          {fields.map(
            (f) =>
              f.value && (
                <div key={f.label} className="flex justify-between text-sm">
                  <dt className="text-[var(--color-slate)]">{f.label}</dt>
                  <dd className="font-medium text-[var(--color-charcoal)]">
                    {f.value}
                  </dd>
                </div>
              )
          )}
        </dl>
      </div>

      {/* Clinical Details */}
      <div className="rounded-xl border border-[var(--color-border)] bg-white p-5">
        <h3 className="mb-3 text-sm font-semibold text-[var(--color-charcoal)]">
          Clinical Details
        </h3>
        <dl className="space-y-3">
          {clinicalFields.map(
            (f) =>
              f.value && (
                <div key={f.label}>
                  <dt className="text-xs font-medium text-[var(--color-slate)]">
                    {f.label}
                  </dt>
                  <dd className="mt-0.5 text-sm text-[var(--color-charcoal)] whitespace-pre-wrap">
                    {f.value}
                  </dd>
                </div>
              )
          )}
        </dl>
      </div>

      {/* Clinical Notes — spans full width */}
      <div className="lg:col-span-2">
        <ClinicalNotes
          clientId={client.id}
          initialNotes={client.clinicalNotes}
        />
      </div>
    </div>
  );
}

function ProgramTab({ client }: { client: ClientData }) {
  const activeProgram = client.programs.find((p) => p.status === "ACTIVE");

  if (!activeProgram) {
    return (
      <div className="rounded-xl border border-[var(--color-border)] bg-white p-8 text-center">
        <p className="text-[var(--color-slate)]">
          No active program. Create one from the Programs page.
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-[var(--color-border)] bg-white p-5">
      <div className="flex items-center gap-2 mb-4">
        <h3 className="text-sm font-semibold text-[var(--color-charcoal)]">
          {activeProgram.name}
        </h3>
        <span className="rounded-full bg-[var(--color-accent)]/10 px-2 py-0.5 text-[10px] font-medium text-[var(--color-accent)]">
          Active
        </span>
      </div>
      <div className="space-y-3">
        {activeProgram.days.map((day) => (
          <div key={day.label}>
            <h4 className="text-xs font-semibold text-[var(--color-primary)] mb-1">
              {day.label}
            </h4>
            <ul className="space-y-0.5 pl-3">
              {day.exercises.map((pe, i) => (
                <li
                  key={i}
                  className="text-xs text-[var(--color-slate)]"
                >
                  {pe.exercise.name}
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </div>
  );
}

function BookingsTab({ client }: { client: ClientData }) {
  if (client.bookings.length === 0) {
    return (
      <div className="rounded-xl border border-[var(--color-border)] bg-white p-8 text-center">
        <p className="text-[var(--color-slate)]">No bookings yet.</p>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {client.bookings.map((booking) => (
        <div
          key={booking.id}
          className="flex items-center justify-between rounded-xl border border-[var(--color-border)] bg-white p-4"
        >
          <div>
            <p className="text-sm font-medium text-[var(--color-charcoal)]">
              {new Date(booking.date).toLocaleDateString("en-AU", {
                weekday: "short",
                day: "numeric",
                month: "short",
              })}
            </p>
            <p className="text-xs text-[var(--color-slate)]">
              {booking.startTime} – {booking.endTime}
              {booking.type && ` · ${booking.type}`}
            </p>
          </div>
          <span
            className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${
              booking.status === "CONFIRMED"
                ? "bg-[var(--color-accent)]/10 text-[var(--color-accent)]"
                : booking.status === "CANCELLED"
                ? "bg-[var(--color-red)]/10 text-[var(--color-red)]"
                : "bg-[var(--color-amber)]/10 text-[var(--color-amber)]"
            }`}
          >
            {booking.status}
          </span>
        </div>
      ))}
    </div>
  );
}

function PlaceholderTab({ label }: { label: string }) {
  return (
    <div className="rounded-xl border border-[var(--color-border)] bg-white p-8 text-center">
      <p className="text-[var(--color-slate)]">{label} will appear here.</p>
    </div>
  );
}
