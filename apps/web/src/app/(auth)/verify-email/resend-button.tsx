"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { authClient } from "@/lib/auth-client";

export function ResendButton({ email }: { email: string }) {
  const [state, setState] = useState<"idle" | "sending" | "sent">("idle");
  return (
    <Button
      type="button"
      variant="secondary"
      loading={state === "sending"}
      disabled={state === "sent"}
      onClick={async () => {
        setState("sending");
        await authClient.sendVerificationEmail({ email, callbackURL: "/dashboard?verified=1" });
        setState("sent");
      }}
    >
      {state === "sent" ? "Sent. Check again in a minute." : "Send the link again"}
    </Button>
  );
}
