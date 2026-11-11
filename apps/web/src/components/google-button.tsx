"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { authClient } from "@/lib/auth-client";

export function GoogleButton({ callbackURL = "/dashboard" }: { callbackURL?: string }) {
  const [loading, setLoading] = useState(false);
  return (
    <Button
      type="button"
      variant="secondary"
      className="w-full"
      loading={loading}
      onClick={async () => {
        setLoading(true);
        await authClient.signIn.social({ provider: "google", callbackURL });
        setLoading(false);
      }}
    >
      <svg className="size-4" viewBox="0 0 24 24" aria-hidden>
        <path
          fill="currentColor"
          d="M21.35 11.1h-9.18v2.96h5.27c-.23 1.2-.92 2.21-1.96 2.9v2.4h3.17c1.86-1.71 2.93-4.24 2.93-7.24 0-.7-.07-1.37-.23-2.02Z"
        />
        <path
          fill="currentColor"
          d="M12.17 21.5c2.65 0 4.87-.88 6.49-2.37l-3.17-2.4c-.88.59-2 .94-3.32.94-2.55 0-4.71-1.72-5.48-4.04H3.42v2.48A9.8 9.8 0 0 0 12.17 21.5Z"
        />
        <path
          fill="currentColor"
          d="M6.69 13.63a5.9 5.9 0 0 1 0-3.76V7.39H3.42a9.82 9.82 0 0 0 0 8.72l3.27-2.48Z"
        />
        <path
          fill="currentColor"
          d="M12.17 6.33c1.44 0 2.73.5 3.75 1.47l2.81-2.81C17.03 3.41 14.82 2.5 12.17 2.5A9.8 9.8 0 0 0 3.42 7.39l3.27 2.48c.77-2.32 2.93-4.04 5.48-4.04Z"
        />
      </svg>
      Continue with Google
    </Button>
  );
}
