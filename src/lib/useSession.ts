import { useEffect, useState } from 'preact/hooks';
import { authClient } from './authClient';
import { clearSessionHint, hasSessionHint } from './authModal';

export interface SessionUser {
  id: string;
  name: string;
  email: string;
  username?: string | null;
  image?: string | null;
}

// Module-level cache so every island on a page shares ONE /api/auth/get-session
// fetch. `undefined` = not yet loaded; `null` = loaded, logged out.
let cachedUser: SessionUser | null | undefined;
let inflight: Promise<SessionUser | null> | null = null;

function load(force = false): Promise<SessionUser | null> {
  if (!force && cachedUser !== undefined) return Promise.resolve(cachedUser);
  if (!force && !hasSessionHint()) {
    cachedUser = null;
    return Promise.resolve(null);
  }
  // On force (e.g. after a session-changed event) bypass any pending request so
  // we never resolve from a stale in-flight getSession().
  if (force || !inflight) {
    inflight = authClient
      .getSession()
      .then((res: { data?: { user?: SessionUser } | null }) => {
        cachedUser = res?.data?.user ?? null;
        if (!cachedUser) clearSessionHint();
        inflight = null;
        return cachedUser;
      })
      .catch(() => {
        cachedUser = null;
        clearSessionHint();
        inflight = null;
        return null;
      });
  }
  return inflight;
}

/**
 * Shared auth-state hook for islands. Reads the cached session, and reloads when
 * a `session-changed` event fires (after login/logout). See {@link authClient}.
 */
export function useSession(): { user: SessionUser | null; loading: boolean } {
  // Always start in the loading state so the FIRST client render reproduces the
  // server's output. `load()` only runs in the effect below (never during SSR),
  // so every island is server-rendered as `loading` regardless of cache. Reading
  // the shared module cache here caused hydration mismatches: an island that
  // hydrated after an earlier island's effect had synchronously set
  // `cachedUser = null` would render the resolved (logged-out) UI while the SSR
  // markup was still the loading placeholder. The effect resolves the real state
  // on the next tick (immediately from cache when warm).
  const [user, setUser] = useState<SessionUser | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    const run = (force = false) => {
      setLoading(true);
      load(force).then((u) => {
        if (!active) return;
        setUser(u);
        setLoading(false);
      });
    };
    run();

    const onChange = () => {
      cachedUser = undefined;
      run(true);
    };
    window.addEventListener('session-changed', onChange);
    return () => {
      active = false;
      window.removeEventListener('session-changed', onChange);
    };
  }, []);

  return { user, loading };
}
