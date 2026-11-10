import { createMiddleware } from "hono/factory";
import { HTTPException } from "hono/http-exception";
import type { Auth, Session } from "../auth.js";

export type SessionVariables = {
  requestId: string;
  session: Session | null;
};

/** Resolves the session from cookies (null when anonymous) and stores it on the context. */
export function sessionMiddleware(auth: Auth) {
  return createMiddleware<{ Variables: SessionVariables }>(async (c, next) => {
    const session = await auth.api.getSession({ headers: c.req.raw.headers });
    c.set("session", session);
    await next();
  });
}

/** Rejects anonymous requests with 401. Use after `sessionMiddleware`. */
export const requireSession = createMiddleware<{ Variables: SessionVariables }>(async (c, next) => {
  if (!c.get("session")) {
    throw new HTTPException(401, { message: "Sign in required" });
  }
  await next();
});
