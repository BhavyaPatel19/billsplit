import { headers } from "next/headers";
import { MeResponseSchema, type MeResponse } from "@billsplit/contracts";
import { serverApiUrl } from "./api";

/**
 * Current user for server components: forwards the browser's cookies to the API. Returns null
 * when anonymous or when the API is unreachable.
 */
export async function getServerSession(): Promise<MeResponse | null> {
  const cookie = (await headers()).get("cookie");
  if (!cookie) return null;
  try {
    const res = await fetch(`${serverApiUrl()}/api/me`, {
      headers: { cookie },
      cache: "no-store",
    });
    if (!res.ok) return null;
    return MeResponseSchema.parse(await res.json());
  } catch {
    return null;
  }
}
