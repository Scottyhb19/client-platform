"use client";

import { useState, useEffect, useCallback } from "react";

interface TagItem {
  id: string;
  name: string;
  sortOrder: number;
}

export default function SettingsPage() {
  const [tags, setTags] = useState<TagItem[]>([]);
  const [categories, setCategories] = useState<TagItem[]>([]);
  const [loading, setLoading] = useState(true);

  // Practice info (local state — no API for this yet)
  const [practiceName, setPracticeName] = useState("Scott's EP Practice");
  const [practiceEmail, setPracticeEmail] = useState("scottyhb19@gmail.com");
  const [practicePhone, setPracticePhone] = useState("");
  const [practiceAddress, setPracticeAddress] = useState("");

  // Notification preferences (local state)
  const [emailEnabled, setEmailEnabled] = useState(true);
  const [smsEnabled, setSmsEnabled] = useState(false);
  const [reminderHours, setReminderHours] = useState("24");

  const [saved, setSaved] = useState(false);

  const loadData = useCallback(async () => {
    try {
      const [tagsRes, catsRes] = await Promise.all([
        fetch("/api/tags"),
        fetch("/api/categories"),
      ]);
      if (tagsRes.ok) setTags(await tagsRes.json());
      if (catsRes.ok) setCategories(await catsRes.json());
    } catch (err) {
      console.error("Failed to load settings:", err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  function showSaved() {
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }

  if (loading) {
    return (
      <div className="text-sm text-[var(--color-slate)]">
        Loading settings...
      </div>
    );
  }

  return (
    <div className="max-w-3xl">
      <div className="mb-6">
        <h1 className="font-[family-name:var(--font-display)] font-extrabold text-2xl text-[var(--color-charcoal)]">
          Settings
        </h1>
        <div className="text-xs text-[var(--color-slate)] mt-0.5">
          Manage your practice, notifications, and configuration
        </div>
      </div>

      {/* Save confirmation */}
      {saved && (
        <div className="fixed top-4 right-4 z-50 bg-[var(--color-accent)] text-[var(--color-charcoal)] font-semibold text-sm px-4 py-2.5 rounded-xl shadow-lg">
          Settings saved
        </div>
      )}

      <div className="space-y-6">
        {/* Practice Info */}
        <SettingsSection title="Practice Information" description="Your business details shown on communications and invoices.">
          <div className="grid grid-cols-2 gap-4">
            <FieldInput
              label="Practice Name"
              value={practiceName}
              onChange={setPracticeName}
            />
            <FieldInput
              label="Email"
              type="email"
              value={practiceEmail}
              onChange={setPracticeEmail}
            />
            <FieldInput
              label="Phone"
              type="tel"
              value={practicePhone}
              onChange={setPracticePhone}
              placeholder="e.g. 04xx xxx xxx"
            />
            <FieldInput
              label="Address"
              value={practiceAddress}
              onChange={setPracticeAddress}
              placeholder="Clinic address"
            />
          </div>
          <button
            onClick={showSaved}
            className="mt-4 px-4 py-2 bg-[var(--color-primary)] text-white rounded-lg font-semibold text-sm border-none cursor-pointer hover:bg-[var(--color-primary-dark)] transition-colors"
          >
            Save Practice Info
          </button>
        </SettingsSection>

        {/* Notifications */}
        <SettingsSection title="Notifications" description="Control how and when clients receive reminders.">
          <div className="space-y-3">
            <ToggleRow
              label="Email notifications"
              description="Appointment confirmations, reminders, and program updates"
              enabled={emailEnabled}
              onToggle={() => setEmailEnabled(!emailEnabled)}
            />
            <ToggleRow
              label="SMS notifications"
              description="Appointment reminders via text message (Twilio costs apply)"
              enabled={smsEnabled}
              onToggle={() => setSmsEnabled(!smsEnabled)}
            />
            <div className="pt-2">
              <label className="block text-xs font-semibold text-[var(--color-slate)] uppercase tracking-wider mb-1">
                Reminder lead time
              </label>
              <select
                value={reminderHours}
                onChange={(e) => setReminderHours(e.target.value)}
                className="w-48 h-10 border border-[var(--color-border)] rounded-lg px-3 text-sm text-[var(--color-charcoal)] bg-[var(--color-background)] outline-none focus:border-[var(--color-primary)] focus:bg-white"
              >
                <option value="2">2 hours before</option>
                <option value="4">4 hours before</option>
                <option value="12">12 hours before</option>
                <option value="24">24 hours before</option>
                <option value="48">48 hours before</option>
              </select>
            </div>
          </div>
          <button
            onClick={showSaved}
            className="mt-4 px-4 py-2 bg-[var(--color-primary)] text-white rounded-lg font-semibold text-sm border-none cursor-pointer hover:bg-[var(--color-primary-dark)] transition-colors"
          >
            Save Notification Preferences
          </button>
        </SettingsSection>

        {/* Exercise Tags */}
        <SettingsSection title="Exercise Tags" description="Tags for categorising exercises (e.g. DGR, PRI, Rehab). Used in the exercise library.">
          <TagManager
            items={tags}
            apiPath="/api/tags"
            onUpdate={loadData}
            placeholder="New tag name..."
          />
        </SettingsSection>

        {/* Client Categories */}
        <SettingsSection title="Client Categories" description="Categories for organising clients (e.g. NDIS, Private, Workers Comp).">
          <TagManager
            items={categories}
            apiPath="/api/categories"
            onUpdate={loadData}
            placeholder="New category name..."
          />
        </SettingsSection>
      </div>
    </div>
  );
}

// --- Subcomponents ---

function SettingsSection({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <div className="bg-white border border-[var(--color-border)] rounded-xl overflow-hidden">
      <div className="px-5 py-4 border-b border-[var(--color-border)]">
        <h2 className="font-[family-name:var(--font-display)] font-bold text-base text-[var(--color-charcoal)]">
          {title}
        </h2>
        <div className="text-xs text-[var(--color-slate)] mt-0.5">
          {description}
        </div>
      </div>
      <div className="px-5 py-4">{children}</div>
    </div>
  );
}

function FieldInput({
  label,
  value,
  onChange,
  type = "text",
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
  placeholder?: string;
}) {
  return (
    <div>
      <label className="block text-xs font-semibold text-[var(--color-slate)] uppercase tracking-wider mb-1">
        {label}
      </label>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full h-10 border border-[var(--color-border)] rounded-lg px-3 text-sm text-[var(--color-charcoal)] bg-[var(--color-background)] outline-none focus:border-[var(--color-primary)] focus:bg-white placeholder:text-[var(--color-slate)]"
      />
    </div>
  );
}

function ToggleRow({
  label,
  description,
  enabled,
  onToggle,
}: {
  label: string;
  description: string;
  enabled: boolean;
  onToggle: () => void;
}) {
  return (
    <div className="flex items-center justify-between py-2">
      <div>
        <div className="font-semibold text-sm text-[var(--color-charcoal)]">
          {label}
        </div>
        <div className="text-xs text-[var(--color-slate)]">{description}</div>
      </div>
      <button
        onClick={onToggle}
        className={`w-11 h-6 rounded-full relative transition-colors cursor-pointer border-none ${
          enabled ? "bg-[var(--color-accent)]" : "bg-[var(--color-border)]"
        }`}
      >
        <div
          className={`absolute top-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform ${
            enabled ? "translate-x-[22px]" : "translate-x-0.5"
          }`}
        />
      </button>
    </div>
  );
}

function TagManager({
  items,
  apiPath,
  onUpdate,
  placeholder,
}: {
  items: { id: string; name: string }[];
  apiPath: string;
  onUpdate: () => void;
  placeholder: string;
}) {
  const [newName, setNewName] = useState("");
  const [adding, setAdding] = useState(false);

  async function addItem() {
    if (!newName.trim()) return;
    setAdding(true);
    try {
      const res = await fetch(apiPath, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: newName.trim() }),
      });
      if (res.ok) {
        setNewName("");
        onUpdate();
      }
    } catch {
      // Skip
    } finally {
      setAdding(false);
    }
  }

  async function removeItem(id: string) {
    try {
      await fetch(apiPath, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      });
      onUpdate();
    } catch {
      // Skip
    }
  }

  return (
    <div>
      {/* Existing items */}
      <div className="flex flex-wrap gap-2 mb-3">
        {items.length > 0 ? (
          items.map((item) => (
            <div
              key={item.id}
              className="flex items-center gap-1.5 bg-[var(--color-background)] border border-[var(--color-border)] rounded-lg px-3 py-1.5"
            >
              <span className="text-sm font-medium text-[var(--color-charcoal)]">
                {item.name}
              </span>
              <button
                onClick={() => removeItem(item.id)}
                className="text-[var(--color-slate)] hover:text-[var(--color-red)] bg-transparent border-none cursor-pointer p-0 ml-1"
              >
                <svg
                  width="12"
                  height="12"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.5"
                  strokeLinecap="round"
                >
                  <path d="M18 6L6 18M6 6l12 12" />
                </svg>
              </button>
            </div>
          ))
        ) : (
          <div className="text-xs text-[var(--color-slate)]">
            None yet. Add one below.
          </div>
        )}
      </div>

      {/* Add new */}
      <div className="flex gap-2">
        <input
          type="text"
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && addItem()}
          placeholder={placeholder}
          className="flex-1 h-9 border border-[var(--color-border)] rounded-lg px-3 text-sm text-[var(--color-charcoal)] bg-[var(--color-background)] outline-none focus:border-[var(--color-primary)] focus:bg-white placeholder:text-[var(--color-slate)]"
        />
        <button
          onClick={addItem}
          disabled={adding || !newName.trim()}
          className="px-3 py-1.5 bg-[var(--color-primary)] text-white rounded-lg font-semibold text-xs border-none cursor-pointer disabled:opacity-40 hover:bg-[var(--color-primary-dark)] transition-colors"
        >
          {adding ? "Adding..." : "Add"}
        </button>
      </div>
    </div>
  );
}
