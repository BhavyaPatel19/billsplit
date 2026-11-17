"use client";

import Link from "next/link";
import { useState } from "react";
import { UnsubscribeStatusSchema, type UnsubscribeStatus } from "@billsplit/contracts";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { CardDescription, CardTitle } from "@/components/ui/card";
import { api, ApiClientError } from "@/lib/api-client";

export function UnsubscribeButton({
  token,
  initial,
}: {
  token: string;
  initial: UnsubscribeStatus;
}) {
  const [status, setStatus] = useState(initial);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const off = !status.prefs.activityEmails && !status.prefs.reminderEmails;

  return off ? (
    <>
      <CardTitle>You are unsubscribed</CardTitle>
      <CardDescription>
        {status.email} will not get expense, payment or reminder emails. Account emails such as
        password resets still arrive. You can turn emails back on under{" "}
        <Link href="/settings" className="underline underline-offset-2">
          Settings
        </Link>
        .
      </CardDescription>
    </>
  ) : (
    <>
      <CardTitle>Stop BillSplit emails?</CardTitle>
      <CardDescription>
        Turns off expense, payment and reminder emails for {status.email}.
      </CardDescription>
      {error ? <Alert tone="error">{error}</Alert> : null}
      <Button
        loading={loading}
        onClick={async () => {
          setLoading(true);
          setError(null);
          try {
            setStatus(
              await api(`/unsubscribe/${encodeURIComponent(token)}`, UnsubscribeStatusSchema, {
                method: "POST",
                body: {},
              }),
            );
          } catch (err) {
            setError(err instanceof ApiClientError ? err.message : "Could not unsubscribe");
          } finally {
            setLoading(false);
          }
        }}
      >
        Unsubscribe
      </Button>
    </>
  );
}
