import {
  HealthResponseSchema,
  MetaResponseSchema,
  type HealthResponse,
  type MetaResponse,
} from "@billsplit/contracts";

/** Base URL for server-side calls to the API (never exposed to the browser). */
export function serverApiUrl(): string {
  return process.env.API_URL ?? "http://localhost:4000";
}

export type ApiHealth = { ok: true; data: HealthResponse } | { ok: false; error: string };

export async function fetchApiHealth(): Promise<ApiHealth> {
  try {
    const res = await fetch(`${serverApiUrl()}/api/healthz`, { cache: "no-store" });
    if (!res.ok) return { ok: false, error: `API responded ${res.status}` };
    const data = HealthResponseSchema.parse(await res.json());
    return { ok: true, data };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "unreachable" };
  }
}

const META_FALLBACK: MetaResponse = { version: "unknown", features: { googleSignIn: false } };

/** Public, non-secret configuration the UI adapts to (e.g. whether Google sign-in is wired up). */
export async function fetchMeta(): Promise<MetaResponse> {
  try {
    const res = await fetch(`${serverApiUrl()}/api/meta`, { next: { revalidate: 60 } });
    if (!res.ok) return META_FALLBACK;
    return MetaResponseSchema.parse(await res.json());
  } catch {
    return META_FALLBACK;
  }
}
