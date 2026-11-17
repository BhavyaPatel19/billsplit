"use client";

import { Check } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import {
  ClaimPageSchema,
  ClaimPersonSchema,
  ReceiptClaimsResponseSchema,
  type ClaimPage,
  type ClaimPerson,
  type ReceiptClaim,
} from "@billsplit/contracts";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardDescription, CardTitle } from "@/components/ui/card";
import { Field } from "@/components/ui/field";
import { api, ApiClientError } from "@/lib/api-client";
import { estimateShare, unclaimedCount } from "@/lib/claim-share";
import { money } from "@/lib/money";
import { cn } from "@/lib/utils";

const POLL_MS = 5000;
/** "equal" shares the line with whoever else tapped it; the rest are fixed percentages. */
const PORTIONS = [
  { value: "equal", label: "My share" },
  { value: "10", label: "A bite (10%)" },
  { value: "25", label: "A quarter" },
  { value: "50", label: "Half" },
] as const;

type MyItem = { itemIndex: number; percent: number | null };

const storageKey = (token: string) => `billsplit.claim.${token}`;

/** Who this browser tapped as last time, so a reload comes back as the same person. */
function readSaved(token: string): string | null {
  try {
    return localStorage.getItem(storageKey(token));
  } catch {
    return null; // Private browsing: they simply pick their name again.
  }
}

function subscribeToStorage(onChange: () => void) {
  window.addEventListener("storage", onChange);
  return () => window.removeEventListener("storage", onChange);
}

export function ClaimBoard({ token, initial }: { token: string; initial: ClaimPage }) {
  const base = `/claim-links/${encodeURIComponent(token)}`;
  const [page, setPage] = useState(initial);
  const [claims, setClaims] = useState<ReceiptClaim[]>(initial.claims);
  const saved = useSyncExternalStore(
    subscribeToStorage,
    () => readSaved(token),
    () => null,
  );
  // undefined: nothing chosen in this visit yet, so fall back to the saved name.
  const [picked, setPicked] = useState<string | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const [gone, setGone] = useState(false);
  const [saving, setSaving] = useState(false);

  // Latest selection waiting to be sent; saves run one at a time so quick taps cannot land
  // out of order.
  const desired = useRef<MyItem[] | null>(null);
  const busy = useRef(false);

  const names = useMemo(
    () => new Map(page.people.map((p) => [p.id, p.displayName])),
    [page.people],
  );
  const guests = page.people.filter((p) => !p.hasAccount);

  const candidate = picked === undefined ? saved : picked;
  // Only ever act as a placeholder that is still in the group.
  const me =
    candidate && page.people.some((p) => p.id === candidate && !p.hasAccount) ? candidate : null;

  const choose = (id: string | null) => {
    setPicked(id);
    setError(null);
    try {
      if (id) localStorage.setItem(storageKey(token), id);
      else localStorage.removeItem(storageKey(token));
    } catch {
      // No storage available.
    }
  };

  const refresh = useCallback(async () => {
    try {
      const next = await api(base, ClaimPageSchema);
      if (busy.current) return;
      setPage(next);
      setClaims(next.claims);
    } catch (err) {
      if (err instanceof ApiClientError && (err.status === 410 || err.status === 404)) {
        setGone(true);
      }
    }
  }, [base]);

  // Pick up what everyone else is tapping.
  useEffect(() => {
    const timer = setInterval(() => {
      if (document.visibilityState === "visible" && !busy.current) void refresh();
    }, POLL_MS);
    return () => clearInterval(timer);
  }, [refresh]);

  const flush = useCallback(
    async (participantId: string) => {
      if (busy.current) return;
      busy.current = true;
      setSaving(true);
      try {
        while (desired.current) {
          const items = desired.current;
          desired.current = null;
          const res = await api(`${base}/claims`, ReceiptClaimsResponseSchema, {
            method: "PUT",
            body: { participantId, items },
          });
          if (!desired.current) setClaims(res.claims);
        }
      } catch (err) {
        desired.current = null;
        if (err instanceof ApiClientError && err.status === 410) setGone(true);
        else setError(err instanceof ApiClientError ? err.message : "Could not save. Try again.");
        busy.current = false;
        await refresh();
      } finally {
        busy.current = false;
        setSaving(false);
      }
    },
    [base, refresh],
  );

  const mine = useMemo(
    () =>
      claims
        .filter((c) => c.participantId === me)
        .map((c) => ({ itemIndex: c.itemIndex, percent: c.percent })),
    [claims, me],
  );

  const save = (next: MyItem[]) => {
    if (!me) return;
    setError(null);
    // Show the tap straight away; the server's answer replaces it.
    setClaims([
      ...claims.filter((c) => c.participantId !== me),
      ...next.map((i) => ({ ...i, participantId: me })),
    ]);
    desired.current = next;
    void flush(me);
  };

  const toggle = (itemIndex: number) =>
    save(
      mine.some((i) => i.itemIndex === itemIndex)
        ? mine.filter((i) => i.itemIndex !== itemIndex)
        : [...mine, { itemIndex, percent: null }],
    );

  const setPortion = (itemIndex: number, value: string) =>
    save(
      mine.map((i) =>
        i.itemIndex === itemIndex
          ? { itemIndex, percent: value === "equal" ? null : Number(value) }
          : i,
      ),
    );

  if (gone) {
    return (
      <Card className="flex flex-col gap-2">
        <CardTitle>This link no longer works</CardTitle>
        <CardDescription>
          It expired or was turned off. Ask whoever sent it for a new one. Anything you already
          tapped was saved.
        </CardDescription>
      </Card>
    );
  }

  const heading = (
    <div className="flex flex-col gap-1">
      <CardTitle>{page.merchant ?? "Shared receipt"}</CardTitle>
      <CardDescription>
        {page.groupName}
        {page.date ? ` · ${page.date}` : ""}
        {page.totalCents !== null ? ` · ${money(page.totalCents, page.currency)}` : ""}
      </CardDescription>
    </div>
  );

  if (!me) {
    return (
      <Card className="flex flex-col gap-6">
        {heading}
        <WhoAreYou
          base={base}
          guests={guests}
          canAdd={page.canAddGuest}
          onPicked={(person) => {
            if (!page.people.some((p) => p.id === person.id)) {
              setPage({ ...page, people: [...page.people, person] });
            }
            choose(person.id);
          }}
        />
      </Card>
    );
  }

  const share = estimateShare(page, claims, me);
  const left = unclaimedCount(page, claims);

  return (
    <>
      <Card className="flex flex-col gap-4">
        {heading}
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          Tapping as{" "}
          <span className="font-medium text-zinc-900 dark:text-zinc-50">{names.get(me)}</span>.{" "}
          <button
            type="button"
            className="underline underline-offset-2"
            onClick={() => choose(null)}
          >
            Not you?
          </button>
        </p>
        {error ? <Alert tone="error">{error}</Alert> : null}
        <ul className="flex flex-col gap-2">
          {page.items.map((item) => {
            const onLine = claims.filter((c) => c.itemIndex === item.index);
            const my = mine.find((i) => i.itemIndex === item.index);
            const others = onLine.filter((c) => c.participantId !== me);
            return (
              <li
                key={item.index}
                className={cn(
                  "rounded-lg border transition-colors",
                  my
                    ? "border-emerald-600 bg-emerald-50 dark:bg-emerald-950/30"
                    : "border-zinc-200 dark:border-zinc-800",
                )}
              >
                <button
                  type="button"
                  aria-pressed={Boolean(my)}
                  onClick={() => toggle(item.index)}
                  className="flex w-full items-start gap-3 p-3 text-left"
                >
                  <span
                    aria-hidden
                    className={cn(
                      "mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full border",
                      my
                        ? "border-emerald-600 bg-emerald-600 text-white"
                        : "border-zinc-300 dark:border-zinc-700",
                    )}
                  >
                    {my ? <Check className="size-3.5" /> : null}
                  </span>
                  <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                    <span className="font-medium">
                      {item.quantity !== 1 ? `${item.quantity} × ` : ""}
                      {item.description}
                    </span>
                    <span className="text-xs text-zinc-500">
                      {others.length > 0
                        ? `Also: ${others
                            .map(
                              (c) =>
                                `${names.get(c.participantId) ?? "Someone"}${
                                  c.percent !== null ? ` (${c.percent}%)` : ""
                                }`,
                            )
                            .join(", ")}`
                        : my
                          ? "Only you so far"
                          : "Nobody yet"}
                    </span>
                  </span>
                  <span className="shrink-0 tabular-nums">
                    {money(item.totalPriceCents, page.currency)}
                  </span>
                </button>
                {my ? (
                  <div className="flex items-center gap-2 px-3 pb-3 pl-11 text-sm">
                    <label
                      htmlFor={`portion-${item.index}`}
                      className="text-zinc-600 dark:text-zinc-400"
                    >
                      I had
                    </label>
                    <select
                      id={`portion-${item.index}`}
                      value={my.percent === null ? "equal" : String(my.percent)}
                      onChange={(e) => setPortion(item.index, e.target.value)}
                      className="h-8 rounded-md border border-zinc-300 bg-white px-2 text-sm dark:border-zinc-700 dark:bg-zinc-900"
                    >
                      {PORTIONS.map((p) => (
                        <option key={p.value} value={p.value}>
                          {p.label}
                        </option>
                      ))}
                      {my.percent !== null &&
                      !PORTIONS.some((p) => p.value === String(my.percent)) ? (
                        <option value={String(my.percent)}>{my.percent}%</option>
                      ) : null}
                    </select>
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      </Card>

      <Card className="sticky bottom-4 flex flex-col gap-1 shadow-md" aria-live="polite">
        <div className="flex items-baseline justify-between">
          <span className="text-sm text-zinc-600 dark:text-zinc-400">Your share, about</span>
          <span className="text-xl font-semibold tabular-nums">
            {money(share.totalCents, page.currency)}
          </span>
        </div>
        <p className="text-xs text-zinc-500">
          {money(share.itemsCents, page.currency)} in items
          {share.extrasCents !== 0
            ? ` + ${money(share.extrasCents, page.currency)} tax, tip and fees`
            : ""}
          {" · "}
          {saving ? "Saving…" : "Saved"}
          {left > 0 ? ` · ${left} ${left === 1 ? "item" : "items"} unclaimed` : ""}
        </p>
      </Card>
    </>
  );
}

function WhoAreYou({
  base,
  guests,
  canAdd,
  onPicked,
}: {
  base: string;
  guests: ClaimPerson[];
  canAdd: boolean;
  onPicked: (person: ClaimPerson) => void;
}) {
  const [name, setName] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  return (
    <div className="flex flex-col gap-4">
      <h2 className="font-medium">Who are you?</h2>
      {guests.length > 0 ? (
        <div className="flex flex-wrap gap-2">
          {guests.map((person) => (
            <Button key={person.id} variant="secondary" onClick={() => onPicked(person)}>
              {person.displayName}
            </Button>
          ))}
        </div>
      ) : null}
      {canAdd ? (
        <form
          className="flex flex-col gap-3"
          onSubmit={async (e) => {
            e.preventDefault();
            if (!name.trim()) return;
            setLoading(true);
            setError(null);
            try {
              onPicked(
                await api(`${base}/guests`, ClaimPersonSchema, { body: { displayName: name } }),
              );
            } catch (err) {
              setError(err instanceof ApiClientError ? err.message : "Could not add you");
              setLoading(false);
            }
          }}
        >
          <Field
            label={guests.length > 0 ? "Not listed? Add your name" : "Your name"}
            name="displayName"
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={80}
            autoComplete="given-name"
            error={error ?? undefined}
          />
          <Button type="submit" loading={loading} disabled={!name.trim() || loading}>
            Continue
          </Button>
        </form>
      ) : (
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          Not listed? Ask whoever sent the link to add you.
        </p>
      )}
      <p className="text-xs text-zinc-500">
        Have an account in this group? Sign in and claim from the receipt there instead.
      </p>
    </div>
  );
}
