/**
 * Who is using PFO right now, and what they may do.
 *
 * Identity comes from the SERVER as of Stage 3B — `AuthGate` exchanges a
 * bearer token for `GET /api/auth/me` and passes the result here. Before that
 * it came from the prototype store's own user list, which meant the browser
 * was asserting its own identity; now it is reporting one the server issued.
 *
 * Permission answers come from `hasPermissionWithOverrides` in
 * `src/domain/permissions/` — role grants plus this user's own explicit
 * grants and denials, which the server now sends with the session. That is the
 * ONE implementation of this question in PFO: the API's `authorize.ts` calls
 * the same function on the same catalogue. There is deliberately no
 * frontend-specific permission model, because two implementations of "may
 * they?" is how a button appears for someone the server will refuse.
 *
 * NONE OF THIS IS A SECURITY BOUNDARY (BR-060). `session.can()` decides what
 * is DRAWN. Every request is re-checked server-side against overrides read
 * fresh from the database, so a user who edits their own session state gains a
 * visible button and a 403 behind it.
 */

import { createContext, useContext, useMemo, type ReactNode } from "react";

import { hasPermissionWithOverrides, type Role, type Scope } from "@domain/permissions/index.js";

import type { ApiSessionUser } from "./api/types.js";

interface SessionValue {
  /** The signed-in employee, as the server describes them. */
  user: ApiSessionUser;
  /** Their display name. Named separately because the API calls it `fullName`
   * and half the prototype calls it `name`; screens should read this. */
  displayName: string;
  roles: readonly Role[];
  can: (permission: string, scope?: Scope) => boolean;
  /** `can` at `all`, or `can` at `own` while actually owning the thing. The
   * exact rule `canActOnCase` applies on the server, so the UI and the API
   * agree about a Telecaller's own case. */
  canActOnCase: (ownerUserId: string, permission: string) => boolean;
  /** Ends the session and returns to the login screen. */
  logout: () => void;
}

const SessionContext = createContext<SessionValue | null>(null);

export function SessionProvider({
  user,
  onLogout,
  children,
}: {
  user: ApiSessionUser;
  onLogout: () => void;
  children: ReactNode;
}): ReactNode {
  const value = useMemo<SessionValue>(() => {
    const roles = user.roles;
    const overrides = user.overrides;

    const can = (permission: string, scope: Scope = "own"): boolean =>
      hasPermissionWithOverrides(roles as Role[], overrides, permission, scope);

    return {
      user,
      displayName: user.fullName,
      roles,
      can,
      canActOnCase: (ownerUserId: string, permission: string) =>
        can(permission, "all") || (can(permission, "own") && ownerUserId === user.id),
      logout: onLogout,
    };
  }, [user, onLogout]);

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionValue {
  const value = useContext(SessionContext);
  if (!value) {
    throw new Error("useSession must be used inside SessionProvider");
  }
  return value;
}
