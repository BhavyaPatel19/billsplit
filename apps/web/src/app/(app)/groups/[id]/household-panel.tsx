"use client";

import { Home, Plane, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import {
  AwayPeriodSchema,
  HouseholdResidentSchema,
  type GroupDetail,
  type HouseholdResident,
  type HouseholdResponse,
} from "@billsplit/contracts";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { api, ApiClientError } from "@/lib/api-client";
import { formatDate } from "@/lib/recurring";

const inputClass =
  "h-9 w-full rounded-md border border-zinc-300 bg-white px-2 text-sm shadow-sm focus:border-emerald-600 focus:outline-none focus:ring-2 focus:ring-emerald-600/30 disabled:bg-zinc-50 disabled:text-zinc-500 dark:border-zinc-700 dark:bg-zinc-900 dark:disabled:bg-zinc-950";

type RowDraft = { roomWeight: string; movedInOn: string; movedOutOn: string };
const toDraft = (r: HouseholdResident): RowDraft => ({
  roomWeight: String(r.roomWeight),
  movedInOn: r.movedInOn ?? "",
  movedOutOn: r.movedOutOn ?? "",
});

/**
 * Room weights, move dates and trips. Household splits on the expense form (and repeating
 * household bills) read these; saved bills keep the numbers they were made with.
 */
export function HouseholdPanel({
  group,
  initial,
}: {
  group: GroupDetail;
  initial: HouseholdResponse;
}) {
  const router = useRouter();
  const [residents, setResidents] = useState(initial.residents);
  const [drafts, setDrafts] = useState(() =>
    Object.fromEntries(initial.residents.map((r) => [r.participantId, toDraft(r)])),
  );
  const [away, setAway] = useState(initial.away);
  const [trip, setTrip] = useState({
    participantId: group.myParticipantId,
    from: "",
    to: "",
    note: "",
  });
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const isOwner = group.participants.some((p) => p.isMe && p.role === "owner");
  const canEdit = (pid: string) => isOwner || pid === group.myParticipantId;
  const name = (pid: string) => {
    const p = group.participants.find((x) => x.id === pid);
    return p ? (p.isMe ? "You" : p.displayName) : "Someone";
  };
  const fail = (err: unknown, fallback: string) =>
    setError(err instanceof ApiClientError ? err.message : fallback);

  const dirty = (r: HouseholdResident) => {
    const d = drafts[r.participantId];
    const saved = toDraft(r);
    return (
      d !== undefined &&
      (Number(d.roomWeight) !== r.roomWeight ||
        d.movedInOn !== saved.movedInOn ||
        d.movedOutOn !== saved.movedOutOn)
    );
  };

  const save = async (pid: string) => {
    const d = drafts[pid];
    if (!d) return;
    const weight = Number(d.roomWeight);
    if (!Number.isFinite(weight) || weight < 0) {
      setError(`${name(pid)}: room weight must be a number like 1, 1.2 or 140`);
      return;
    }
    setBusy(`save:${pid}`);
    setError(null);
    try {
      const saved = await api(
        `/groups/${group.id}/household/residents/${pid}`,
        HouseholdResidentSchema,
        {
          method: "PATCH",
          body: {
            roomWeight: weight,
            movedInOn: d.movedInOn || null,
            movedOutOn: d.movedOutOn || null,
          },
        },
      );
      setResidents((list) => list.map((r) => (r.participantId === pid ? saved : r)));
      setDrafts((all) => ({ ...all, [pid]: toDraft(saved) }));
      router.refresh();
    } catch (err) {
      fail(err, "Could not save");
    } finally {
      setBusy(null);
    }
  };

  const addTrip = async () => {
    if (!trip.from || !trip.to) {
      setError("Pick the first and last day away");
      return;
    }
    setBusy("trip");
    setError(null);
    try {
      const created = await api(`/groups/${group.id}/household/away`, AwayPeriodSchema, {
        body: { ...trip, note: trip.note.trim() || undefined },
      });
      setAway((list) => [...list, created].sort((a, b) => (a.from < b.from ? -1 : 1)));
      setTrip((t) => ({ ...t, from: "", to: "", note: "" }));
    } catch (err) {
      fail(err, "Could not add the trip");
    } finally {
      setBusy(null);
    }
  };

  const removeTrip = async (id: string) => {
    setBusy(`trip:${id}`);
    setError(null);
    try {
      await api(`/groups/${group.id}/household/away/${id}`, AwayPeriodSchema, { method: "DELETE" });
      setAway((list) => list.filter((a) => a.id !== id));
    } catch (err) {
      fail(err, "Could not remove the trip");
    } finally {
      setBusy(null);
    }
  };

  const setDraft = (pid: string, patch: Partial<RowDraft>) =>
    setDrafts((all) => ({ ...all, [pid]: { ...all[pid]!, ...patch } }));

  return (
    <Card id="household" className="flex scroll-mt-6 flex-col gap-4">
      <div className="flex items-center gap-2">
        <Home className="size-4 text-zinc-500" aria-hidden />
        <h2 className="font-medium">Household</h2>
      </div>
      <p className="text-xs text-zinc-500">
        For rent and utilities split &ldquo;by household&rdquo;. Room weight can be square feet or a
        simple number (1.2 for the room with the bathroom). Leave the dates empty for anyone there
        the whole time.
      </p>
      {error ? <Alert tone="error">{error}</Alert> : null}

      <ul className="flex flex-col gap-3">
        {residents.map((r) => {
          const d = drafts[r.participantId] ?? toDraft(r);
          const editable = canEdit(r.participantId);
          return (
            <li key={r.participantId} className="flex flex-col gap-1.5">
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm font-medium">{name(r.participantId)}</span>
                {editable && dirty(r) ? (
                  <Button
                    size="sm"
                    variant="secondary"
                    loading={busy === `save:${r.participantId}`}
                    onClick={() => save(r.participantId)}
                  >
                    Save
                  </Button>
                ) : null}
              </div>
              <div className="grid grid-cols-3 gap-2">
                <label className="flex flex-col gap-0.5 text-[11px] text-zinc-500">
                  Room weight
                  <input
                    inputMode="decimal"
                    className={inputClass}
                    value={d.roomWeight}
                    disabled={!editable}
                    onChange={(e) => setDraft(r.participantId, { roomWeight: e.target.value })}
                  />
                </label>
                <label className="flex flex-col gap-0.5 text-[11px] text-zinc-500">
                  Moved in
                  <input
                    type="date"
                    className={inputClass}
                    value={d.movedInOn}
                    disabled={!editable}
                    onChange={(e) => setDraft(r.participantId, { movedInOn: e.target.value })}
                  />
                </label>
                <label className="flex flex-col gap-0.5 text-[11px] text-zinc-500">
                  Moved out
                  <input
                    type="date"
                    className={inputClass}
                    value={d.movedOutOn}
                    min={d.movedInOn || undefined}
                    disabled={!editable}
                    onChange={(e) => setDraft(r.participantId, { movedOutOn: e.target.value })}
                  />
                </label>
              </div>
            </li>
          );
        })}
      </ul>

      <div className="flex flex-col gap-2 border-t border-zinc-200 pt-3 dark:border-zinc-800">
        <h3 className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-zinc-500">
          <Plane className="size-3.5" aria-hidden /> Trips (come off utilities, not rent)
        </h3>
        {away.length > 0 ? (
          <ul className="flex flex-col gap-1 text-sm">
            {away.map((a) => (
              <li key={a.id} className="flex items-center justify-between gap-2">
                <span>
                  {name(a.participantId)}: {formatDate(a.from)} – {formatDate(a.to)}
                  {a.note ? <span className="text-zinc-500"> · {a.note}</span> : null}
                </span>
                {canEdit(a.participantId) ? (
                  <Button
                    size="sm"
                    variant="ghost"
                    aria-label="Remove trip"
                    loading={busy === `trip:${a.id}`}
                    onClick={() => removeTrip(a.id)}
                  >
                    <Trash2 className="size-4" aria-hidden />
                  </Button>
                ) : null}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-xs text-zinc-500">No trips yet.</p>
        )}
        <div className="grid grid-cols-2 gap-2">
          {isOwner ? (
            <select
              className={inputClass}
              value={trip.participantId}
              onChange={(e) => setTrip({ ...trip, participantId: e.target.value })}
              aria-label="Who was away"
            >
              {residents.map((r) => (
                <option key={r.participantId} value={r.participantId}>
                  {name(r.participantId)}
                </option>
              ))}
            </select>
          ) : null}
          <input
            className={inputClass}
            placeholder="Note (optional)"
            value={trip.note}
            onChange={(e) => setTrip({ ...trip, note: e.target.value })}
          />
          <input
            type="date"
            className={inputClass}
            aria-label="First day away"
            value={trip.from}
            onChange={(e) => setTrip({ ...trip, from: e.target.value })}
          />
          <input
            type="date"
            className={inputClass}
            aria-label="Last day away"
            value={trip.to}
            min={trip.from || undefined}
            onChange={(e) => setTrip({ ...trip, to: e.target.value })}
          />
        </div>
        <Button size="sm" variant="secondary" loading={busy === "trip"} onClick={addTrip}>
          Add trip
        </Button>
      </div>
    </Card>
  );
}
