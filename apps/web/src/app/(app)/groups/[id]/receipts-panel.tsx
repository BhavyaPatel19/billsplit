"use client";

import {
  AlertCircle,
  Camera,
  CheckCircle2,
  Clock,
  ExternalLink,
  Loader2,
  Receipt as ReceiptIcon,
  Sparkles,
  Upload,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type ChangeEvent } from "react";
import {
  RECEIPT_CONTENT_TYPES,
  RECEIPT_SAMPLES,
  ReceiptListResponseSchema,
  ReceiptSchema,
  type GroupDetail,
  type Receipt,
  type ReceiptSampleId,
  type ReceiptStatus,
} from "@billsplit/contracts";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { api, ApiClientError } from "@/lib/api-client";
import { money } from "@/lib/money";
import { formatBytes, uploadReceiptFile, type UploadStage } from "@/lib/receipt-upload";
import { cn } from "@/lib/utils";

const ACCEPT = RECEIPT_CONTENT_TYPES.join(",");
const POLL_MS = 2000;
const MAX_POLLS = 30;

const STAGE_LABEL: Record<UploadStage, string> = {
  starting: "Preparing…",
  uploading: "Uploading photo…",
  confirming: "Confirming…",
};

const STATUS_META: Record<
  ReceiptStatus,
  { label: string; tone: string; spin?: boolean; Icon: typeof Clock }
> = {
  awaiting_upload: {
    label: "Upload incomplete",
    tone: "bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300",
    Icon: Clock,
  },
  uploaded: {
    label: "Queued",
    tone: "bg-sky-50 text-sky-700 dark:bg-sky-950/60 dark:text-sky-300",
    spin: true,
    Icon: Loader2,
  },
  processing: {
    label: "Processing…",
    tone: "bg-sky-50 text-sky-700 dark:bg-sky-950/60 dark:text-sky-300",
    spin: true,
    Icon: Loader2,
  },
  needs_review: {
    label: "Needs review",
    tone: "bg-amber-50 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300",
    Icon: AlertCircle,
  },
  ready: {
    label: "Ready",
    tone: "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300",
    Icon: CheckCircle2,
  },
  failed: {
    label: "Failed",
    tone: "bg-red-50 text-red-700 dark:bg-red-950/60 dark:text-red-300",
    Icon: AlertCircle,
  },
};

const errorMessage = (err: unknown, fallback: string) =>
  err instanceof ApiClientError || err instanceof Error ? err.message : fallback;

export function ReceiptsPanel({
  group,
  initialReceipts,
  uploadsEnabled,
  samplesEnabled,
  scansPerDay,
}: {
  group: GroupDetail;
  initialReceipts: Receipt[];
  uploadsEnabled: boolean;
  samplesEnabled: boolean;
  /** 0 when unknown. */
  scansPerDay: number;
}) {
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const [recentUpload, setRecentUpload] = useState<Receipt | null>(null);
  const [polled, setPolled] = useState<{ base: Receipt[]; receipts: Receipt[] } | null>(null);
  const [stage, setStage] = useState<UploadStage | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [addingSample, setAddingSample] = useState<ReceiptSampleId | null>(null);

  const baseReceipts =
    recentUpload && !initialReceipts.some((r) => r.id === recentUpload.id)
      ? [recentUpload, ...initialReceipts]
      : initialReceipts;
  const receipts = polled && polled.base === initialReceipts ? polled.receipts : baseReceipts;

  const hasPending = receipts.some((r) => r.status === "uploaded" || r.status === "processing");

  useEffect(() => {
    if (!hasPending) return;
    let cancelled = false;
    let polls = 0;

    const timer = setInterval(() => {
      polls += 1;
      if (polls > MAX_POLLS) {
        clearInterval(timer);
        return;
      }
      void api(`/groups/${group.id}/receipts`, ReceiptListResponseSchema)
        .then((res) => {
          if (cancelled) return;
          setPolled({ base: initialReceipts, receipts: res.receipts });
          if (!res.receipts.some((r) => r.status === "uploaded" || r.status === "processing")) {
            router.refresh();
          }
        })
        .catch(() => {
          // Transient polling errors are ignored; next tick or manual refresh recovers.
        });
    }, POLL_MS);

    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [group.id, hasPending, initialReceipts, router]);

  const uploaderName = (pid: string | null) => {
    if (!pid) return "Former member";
    const p = group.participants.find((x) => x.id === pid);
    return p ? (p.isMe ? "You" : p.displayName) : "Former member";
  };

  const handleFileChange = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;

    setError(null);
    setStage("starting");
    try {
      const uploaded = await uploadReceiptFile(group.id, file, { onStageChange: setStage });
      setRecentUpload(uploaded);
      setPolled(null);
      router.refresh();
    } catch (err) {
      setError(errorMessage(err, "Could not upload that receipt."));
    } finally {
      setStage(null);
    }
  };

  const handleSample = async (sampleId: ReceiptSampleId) => {
    setError(null);
    setAddingSample(sampleId);
    try {
      const created = await api(`/groups/${group.id}/receipts/samples`, ReceiptSchema, {
        body: { sampleId },
      });
      setRecentUpload(created);
      setPolled(null);
      router.refresh();
    } catch (err) {
      setError(errorMessage(err, "Could not add that sample."));
    } finally {
      setAddingSample(null);
    }
  };

  const uploading = stage !== null;
  const busy = uploading || addingSample !== null;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-lg font-semibold">Receipts</h2>
        {uploadsEnabled ? (
          <div className="flex flex-wrap gap-2">
            <input
              ref={cameraInputRef}
              type="file"
              accept={ACCEPT}
              capture="environment"
              className="sr-only"
              disabled={busy}
              aria-label="Take a receipt photo with camera"
              onChange={(e) => void handleFileChange(e)}
            />
            <input
              ref={fileInputRef}
              type="file"
              accept={ACCEPT}
              className="sr-only"
              disabled={busy}
              aria-label="Choose a receipt photo"
              onChange={(e) => void handleFileChange(e)}
            />
            <Button
              type="button"
              variant="secondary"
              disabled={busy}
              onClick={() => cameraInputRef.current?.click()}
            >
              <Camera className="size-4" aria-hidden /> Take photo
            </Button>
            <Button
              type="button"
              variant="secondary"
              loading={uploading}
              disabled={busy}
              onClick={() => fileInputRef.current?.click()}
            >
              {!uploading ? <Upload className="size-4" aria-hidden /> : null}
              {stage ? STAGE_LABEL[stage] : "Upload receipt"}
            </Button>
          </div>
        ) : null}
      </div>

      {samplesEnabled ? (
        <div className="flex flex-wrap items-center gap-2 text-xs text-zinc-600 dark:text-zinc-400">
          <Sparkles className="size-3.5 text-amber-500" aria-hidden />
          <span>Try a sample:</span>
          {RECEIPT_SAMPLES.map((sample) => (
            <Button
              key={sample.id}
              type="button"
              variant="secondary"
              className="h-7 px-2.5 text-xs"
              title={sample.summary}
              disabled={busy}
              loading={addingSample === sample.id}
              onClick={() => void handleSample(sample.id)}
            >
              {sample.title}
            </Button>
          ))}
        </div>
      ) : null}

      {uploadsEnabled && scansPerDay > 0 ? (
        <p className="text-xs text-zinc-500">
          Up to {scansPerDay} photo scans per person per day. Samples don&apos;t count.
        </p>
      ) : !uploadsEnabled && samplesEnabled ? (
        <p className="text-xs text-zinc-500">
          Photo uploads are turned off in this demo; the samples run the full pipeline.
        </p>
      ) : null}

      {error ? <Alert tone="error">{error}</Alert> : null}

      {receipts.length === 0 ? (
        <Card className="flex flex-col items-center gap-2 py-8 text-center text-sm text-zinc-600 dark:text-zinc-400">
          <ReceiptIcon className="size-7 text-zinc-400" aria-hidden />
          {uploadsEnabled
            ? "No receipts uploaded yet. Snap or upload a JPEG, PNG, or WebP photo (up to 10 MB)."
            : "No receipts yet. Add a sample above to see how scanning works."}
        </Card>
      ) : (
        <ul className="flex flex-col divide-y divide-zinc-100 rounded-xl border border-zinc-200 bg-white dark:divide-zinc-800 dark:border-zinc-800 dark:bg-zinc-900">
          {receipts.map((r) => {
            const meta = STATUS_META[r.status];
            const StatusIcon = meta.Icon;
            return (
              <li key={r.id} className="flex items-center justify-between gap-4 px-4 py-3">
                <div className="flex min-w-0 items-center gap-3">
                  {r.thumbnailUrl ? (
                    // Presigned S3/RustFS URLs vary per host and expire in 5m, so bypass next/image.
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={r.thumbnailUrl}
                      alt="Receipt thumbnail"
                      className="size-12 shrink-0 rounded-md border border-zinc-200 object-cover dark:border-zinc-700"
                    />
                  ) : (
                    <div className="flex size-12 shrink-0 items-center justify-center rounded-md border border-zinc-200 bg-zinc-50 text-zinc-400 dark:border-zinc-800 dark:bg-zinc-800/60">
                      <StatusIcon
                        className={cn("size-5", meta.spin && "animate-spin")}
                        aria-hidden
                      />
                    </div>
                  )}
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span
                        className={cn(
                          "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium",
                          meta.tone,
                        )}
                      >
                        <StatusIcon
                          className={cn("size-3", meta.spin && "animate-spin")}
                          aria-hidden
                        />
                        {meta.label}
                      </span>
                      {r.sampleId ? (
                        <span className="rounded-full bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-800 dark:bg-amber-950/60 dark:text-amber-300">
                          Sample
                        </span>
                      ) : null}
                      <span className="text-xs text-zinc-500">
                        {r.createdAt.slice(0, 10)} · {formatBytes(r.sizeBytes)}
                      </span>
                    </div>
                    {r.ocr ? (
                      <p className="mt-1 truncate text-sm font-medium">
                        {r.ocr.merchant ?? "Unknown merchant"}
                        {r.ocr.totalCents !== null
                          ? ` · ${money(r.ocr.totalCents, r.ocr.currency ?? "USD")}`
                          : ""}
                        <span className="font-normal text-zinc-500">
                          {" "}
                          · {r.ocr.items.length} {r.ocr.items.length === 1 ? "item" : "items"}
                        </span>
                      </p>
                    ) : null}
                    <p className="mt-1 truncate text-xs text-zinc-600 dark:text-zinc-400">
                      Added by {uploaderName(r.uploadedBy)}
                    </p>
                    {r.status === "needs_review" && r.ocr?.reconciliation.reason ? (
                      <p className="mt-1 text-xs text-amber-700 dark:text-amber-400">
                        {r.ocr.reconciliation.reason}
                      </p>
                    ) : null}
                    {r.status === "failed" && r.error ? (
                      <p className="mt-1 text-xs text-red-600 dark:text-red-400">{r.error}</p>
                    ) : null}
                  </div>
                </div>
                {r.imageUrl ? (
                  <a
                    href={r.imageUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex shrink-0 items-center gap-1 text-xs font-medium text-emerald-700 hover:underline dark:text-emerald-400"
                  >
                    View <ExternalLink className="size-3.5" aria-hidden />
                  </a>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
