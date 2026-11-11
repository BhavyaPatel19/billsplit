"use client";

import { Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api-client";

export function DeleteExpenseButton({
  groupId,
  expenseId,
}: {
  groupId: string;
  expenseId: string;
}) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [loading, setLoading] = useState(false);

  if (!confirming) {
    return (
      <Button variant="ghost" onClick={() => setConfirming(true)}>
        <Trash2 className="size-4" aria-hidden /> Delete
      </Button>
    );
  }
  return (
    <div className="flex gap-2">
      <Button
        variant="danger"
        loading={loading}
        onClick={async () => {
          setLoading(true);
          await api(`/groups/${groupId}/expenses/${expenseId}`, z.undefined(), {
            method: "DELETE",
          });
          router.push(`/groups/${groupId}`);
          router.refresh();
        }}
      >
        Delete for everyone
      </Button>
      <Button variant="ghost" onClick={() => setConfirming(false)}>
        Keep it
      </Button>
    </div>
  );
}
