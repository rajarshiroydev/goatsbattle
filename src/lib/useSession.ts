import { useEffect, useState } from 'preact/hooks';
import { authClient } from './authClient';

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
  if (!inflight) {
    inflight = authClient
      .getSession()
      .then((res: { data?: { user?: SessionUser } | null }) => {
        cachedUser = res?.data?.user ?? null;
        inflight = null;
        return cachedUser;
      })
      .catch(() => {
        cachedUser = null;
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
  const [user, setUser] = useState<SessionUser | null>(cachedUser ?? null);
  const [loading, setLoading] = useState(cachedUser === undefined);

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
