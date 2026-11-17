import { ArrowLeft, ArrowRight, ExternalLink } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { GroupDetailSchema, ReceiptSchema } from "@billsplit/contracts";
import { Card } from "@/components/ui/card";
import { serverApi } from "@/lib/server-api";
import { ReceiptReview } from "./receipt-review";

export const metadata = { title: "Review receipt · BillSplit" };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function ReviewReceiptPage({
  params,
}: {
  params: Promise<{ id: string; receiptId: string }>;
}) {
  const { id, receiptId } = await params;
  if (!UUID_RE.test(id) || !UUID_RE.test(receiptId)) notFound();

  const [group, receipt] = await Promise.all([
    serverApi(`/groups/${id}`, GroupDetailSchema),
    serverApi(`/groups/${id}/receipts/${receiptId}`, ReceiptSchema),
  ]);
  if (!group || !receipt) notFound();

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Link
          href={`/groups/${group.id}`}
          className="inline-flex items-center gap-1 text-sm text-zinc-600 hover:underline dark:text-zinc-400"
        >
          <ArrowLeft className="size-4" aria-hidden /> {group.name}
        </Link>
        {receipt.ocr ? (
          <Link
            href={`/groups/${group.id}/expenses/new?receiptId=${receipt.id}`}
            className="inline-flex items-center gap-1 text-sm font-medium text-emerald-700 hover:underline dark:text-emerald-400"
          >
            Split items <ArrowRight className="size-4" aria-hidden />
          </Link>
        ) : null}
      </div>

      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Review receipt</h1>
        <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
          Compare the extracted lines against your photo, fix any mismatches, then split the items.
        </p>
      </div>

      {receipt.ocr ? (
        <ReceiptReview group={group} receipt={receipt} />
      ) : (
        <Card className="flex flex-col gap-4">
          <p className="text-sm text-zinc-600 dark:text-zinc-400">
            This receipt is currently{" "}
            <span className="font-medium text-zinc-900 dark:text-zinc-100">{receipt.status}</span>{" "}
            and doesn&apos;t have extracted line items yet.
            {receipt.error ? ` (${receipt.error})` : ""}
          </p>
          {receipt.imageUrl ? (
            <div className="flex flex-col items-start gap-2">
              {/* Presigned S3/RustFS URLs vary per host and expire quickly, so bypass next/image. */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={receipt.imageUrl}
                alt="Uploaded receipt"
                className="max-h-96 rounded-lg border border-zinc-200 object-contain dark:border-zinc-800"
              />
              <a
                href={receipt.imageUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-xs font-medium text-emerald-700 hover:underline dark:text-emerald-400"
              >
                Open full image <ExternalLink className="size-3.5" aria-hidden />
              </a>
            </div>
          ) : null}
        </Card>
      )}
    </div>
  );
}
