"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { AcceptInviteResponseSchema } from "@billsplit/contracts";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { api, ApiClientError } from "@/lib/api-client";

export function AcceptButton({ code }: { code: string }) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  return (
    <div className="flex flex-col gap-3">
      {error ? <Alert tone="error">{error}</Alert> : null}
      <Button
        className="w-full"
        loading={loading}
        onClick={async () => {
          setLoading(true);
          setError(null);
          try {
            const result = await api(
              `/invites/${encodeURIComponent(code)}/accept`,
              AcceptInviteResponseSchema,
              {
                body: {},
              },
            );
            router.push(`/groups/${result.groupId}`);
            router.refresh();
          } catch (err) {
            setError(err instanceof ApiClientError ? err.message : "Could not join");
            setLoading(false);
          }
        }}
      >
        Join the group
      </Button>
    </div>
  );
}
