"use client";

import { Download, LogOut, Monitor, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { authClient, useSession } from "@/lib/auth-client";
import { describeDevice } from "@/lib/device";

type Session = {
  id: string;
  token: string;
  createdAt: Date | string;
  userAgent?: string | null;
  ipAddress?: string | null;
};

export function AccountSettings() {
  const router = useRouter();
  const currentToken = useSession().data?.session.token ?? null;
  const [sessions, setSessions] = useState<Session[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [password, setPassword] = useState("");
  const [confirmText, setConfirmText] = useState("");

  const fetchSessions = async () => {
    const { data, error: err } = await authClient.listSessions();
    return err
      ? { error: err.message ?? "Could not load your devices" }
      : { sessions: data as Session[] };
  };
  const load = async () => {
    const result = await fetchSessions();
    if (result.error) setError(result.error);
    else if (result.sessions) setSessions(result.sessions);
  };
  useEffect(() => {
    let cancelled = false;
    void fetchSessions().then((result) => {
      if (cancelled) return;
      if (result.error) setError(result.error);
      else if (result.sessions) setSessions(result.sessions);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const revoke = async (token: string) => {
    setBusy(token);
    setError(null);
    const { error: err } = await authClient.revokeSession({ token });
    if (err) setError(err.message ?? "Could not sign that device out");
    await load();
    setBusy(null);
  };

  const revokeOthers = async () => {
    setBusy("others");
    setError(null);
    const { error: err } = await authClient.revokeOtherSessions();
    if (err) setError(err.message ?? "Could not sign the other devices out");
    await load();
    setBusy(null);
  };

  const deleteAccount = async () => {
    setBusy("delete");
    setError(null);
    const { error: err } = await authClient.deleteUser({ password });
    if (err) {
      setError(err.message ?? "Could not delete your account");
      setBusy(null);
      return;
    }
    router.push("/");
    router.refresh();
  };

  const others = (sessions ?? []).filter((s) => s.token !== currentToken);

  return (
    <>
      {error ? <Alert tone="error">{error}</Alert> : null}
      <Card className="flex flex-col gap-3">
        <div className="flex items-center justify-between gap-3">
          <h2 className="font-medium">Signed-in devices</h2>
          {others.length > 0 ? (
            <Button size="sm" variant="ghost" loading={busy === "others"} onClick={revokeOthers}>
              <LogOut className="size-4" aria-hidden /> Sign out everywhere else
            </Button>
          ) : null}
        </div>
        {sessions === null ? (
          <p className="text-sm text-zinc-500">Loading…</p>
        ) : (
          <ul className="flex flex-col divide-y divide-zinc-100 dark:divide-zinc-800">
            {sessions.map((s) => {
              const current = s.token === currentToken;
              return (
                <li key={s.id} className="flex items-center justify-between gap-3 py-2 text-sm">
                  <span className="flex items-center gap-2">
                    <Monitor className="size-4 text-zinc-400" aria-hidden />
                    <span>
                      {describeDevice(s.userAgent)}
                      {current ? (
                        <span className="ml-2 rounded-full bg-emerald-50 px-2 py-0.5 text-xs text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-200">
                          This device
                        </span>
                      ) : null}
                      <span className="block text-xs text-zinc-500">
                        Since {new Date(s.createdAt).toLocaleDateString()}
                        {s.ipAddress ? ` · ${s.ipAddress}` : ""}
                      </span>
                    </span>
                  </span>
                  {current ? null : (
                    <Button
                      size="sm"
                      variant="ghost"
                      loading={busy === s.token}
                      onClick={() => revoke(s.token)}
                    >
                      Sign out
                    </Button>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </Card>

      <Card className="flex flex-col gap-3">
        <h2 className="font-medium">Your data</h2>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          Download your profile, groups, expenses, payments and balances as a JSON file.
        </p>
        <a
          href="/api/me/export"
          download
          className="inline-flex h-10 w-fit items-center gap-2 rounded-md border border-zinc-300 bg-white px-4 text-sm font-medium hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-900"
        >
          <Download className="size-4" aria-hidden /> Download my data
        </a>
      </Card>

      <Card className="flex flex-col gap-3 border-red-200 dark:border-red-900">
        <h2 className="font-medium text-red-700 dark:text-red-400">Delete account</h2>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          Your groups keep their history: you stay on past bills as a name without an account, and
          groups you own pass to the longest-standing member. A group only you can open is deleted.
          This cannot be undone.
        </p>
        {deleting ? (
          <div className="flex flex-col gap-2">
            <input
              type="password"
              autoComplete="current-password"
              className="h-10 rounded-md border border-zinc-300 bg-white px-3 text-sm dark:border-zinc-700 dark:bg-zinc-900"
              placeholder="Your password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              aria-label="Your password"
            />
            <input
              className="h-10 rounded-md border border-zinc-300 bg-white px-3 text-sm dark:border-zinc-700 dark:bg-zinc-900"
              placeholder='Type "delete" to confirm'
              value={confirmText}
              onChange={(e) => setConfirmText(e.target.value)}
              aria-label="Type delete to confirm"
            />
            <div className="flex gap-2">
              <Button
                variant="danger"
                loading={busy === "delete"}
                disabled={!password || confirmText.trim().toLowerCase() !== "delete"}
                onClick={deleteAccount}
              >
                <Trash2 className="size-4" aria-hidden /> Delete my account
              </Button>
              <Button variant="ghost" onClick={() => setDeleting(false)}>
                Keep it
              </Button>
            </div>
          </div>
        ) : (
          <Button variant="secondary" className="w-fit" onClick={() => setDeleting(true)}>
            Delete account…
          </Button>
        )}
      </Card>
    </>
  );
}
