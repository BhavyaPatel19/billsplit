"use client";

import { useState } from "react";
import { NotificationPrefsSchema, type NotificationPrefs } from "@billsplit/contracts";
import { Alert } from "@/components/ui/alert";
import { Card } from "@/components/ui/card";
import { api, ApiClientError } from "@/lib/api-client";

const OPTIONS: { key: keyof NotificationPrefs; title: string; body: string }[] = [
  {
    key: "activityEmails",
    title: "Expenses and payments",
    body: "When someone adds or edits an expense you are on, or records a payment with you.",
  },
  {
    key: "reminderEmails",
    title: "Weekly reminders",
    body: "At most once a week, while you owe someone more than $1.",
  },
];

export function NotificationSettings({ initial }: { initial: NotificationPrefs }) {
  const [prefs, setPrefs] = useState(initial);
  const [saving, setSaving] = useState<keyof NotificationPrefs | null>(null);
  const [error, setError] = useState<string | null>(null);

  const toggle = async (key: keyof NotificationPrefs) => {
    const next = !prefs[key];
    setSaving(key);
    setError(null);
    setPrefs({ ...prefs, [key]: next });
    try {
      setPrefs(
        await api("/me/notifications", NotificationPrefsSchema, {
          method: "PATCH",
          body: { [key]: next },
        }),
      );
    } catch (err) {
      setPrefs((p) => ({ ...p, [key]: !next }));
      setError(err instanceof ApiClientError ? err.message : "Could not save. Try again.");
    } finally {
      setSaving(null);
    }
  };

  return (
    <Card className="flex flex-col gap-4">
      <h2 className="font-semibold">Email</h2>
      {OPTIONS.map((o) => (
        <label key={o.key} className="flex cursor-pointer items-start justify-between gap-4">
          <span className="flex flex-col gap-0.5">
            <span className="text-sm font-medium">{o.title}</span>
            <span className="text-xs text-zinc-500">{o.body}</span>
          </span>
          <input
            type="checkbox"
            role="switch"
            className="mt-1 size-5 accent-emerald-600"
            checked={prefs[o.key]}
            disabled={saving === o.key}
            onChange={() => void toggle(o.key)}
          />
        </label>
      ))}
      {error ? <Alert tone="error">{error}</Alert> : null}
      <p className="text-xs text-zinc-500">
        Account emails, such as password resets, are always sent.
      </p>
    </Card>
  );
}
