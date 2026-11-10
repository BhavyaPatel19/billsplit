import { HealthResponseSchema, type HealthResponse } from "@billsplit/contracts";

/** Base URL for server-side calls to the API (never exposed to the browser). */
export function serverApiUrl(): string {
  return process.env.API_URL ?? process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";
}

export type ApiHealth = { ok: true; data: HealthResponse } | { ok: false; error: string };

export async function fetchApiHealth(): Promise<ApiHealth> {
  try {
    const res = await fetch(`${serverApiUrl()}/healthz`, { cache: "no-store" });
    if (!res.ok) return { ok: false, error: `API responded ${res.status}` };
    const data = HealthResponseSchema.parse(await res.json());
    return { ok: true, data };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "unreachable" };
  }
}
