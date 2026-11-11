import { headers } from "next/headers";
import type { z } from "zod";
import { serverApiUrl } from "./api";

/**
 * Server-component call to the API on behalf of the current user (cookies forwarded).
 * Returns null on 401/404 so pages can decide between redirect and notFound().
 */
export async function serverApi<S extends z.ZodType>(
  path: string,
  schema: S,
): Promise<z.infer<S> | null> {
  const cookie = (await headers()).get("cookie") ?? "";
  const res = await fetch(`${serverApiUrl()}/api${path}`, {
    headers: { cookie },
    cache: "no-store",
  });
  if (res.status === 401 || res.status === 404) return null;
  if (!res.ok) throw new Error(`API ${path} responded ${res.status}`);
  return schema.parse(await res.json()) as z.infer<S>;
}
