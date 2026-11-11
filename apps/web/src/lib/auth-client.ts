"use client";

import { createAuthClient } from "better-auth/react";

// Same origin: the browser talks to /api/auth, which Next (dev) or Caddy (prod) forwards to the API.
export const authClient = createAuthClient({ basePath: "/api/auth" });

export const { useSession } = authClient;
