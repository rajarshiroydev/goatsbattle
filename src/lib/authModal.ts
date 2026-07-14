/**
 * Tiny window-event bus so any island (vote widgets, comment composer, nav) can
 * open the shared auth modal and react to auth changes without prop drilling.
 * The AuthModal island listens for `open-auth-modal`; after a successful login
 * or logout, code broadcasts `session-changed` so `useSession` consumers reload.
 */

export interface AuthModalDetail {
  /** Optional message shown at the top of the modal (e.g. "Log in to vote"). */
  reason?: string;
  /** Which tab to open on ("signin" default). */
  mode?: 'signin' | 'signup';
}

const SESSION_HINT_KEY = 'gb:session-hint';

/**
 * UI-only hint used to avoid an anonymous session request on every static page.
 * It never grants access; server endpoints still validate the HttpOnly Better
 * Auth cookie. A stale hint can only cause one harmless session lookup.
 */
export function hasSessionHint(): boolean {
  try {
    return window.localStorage.getItem(SESSION_HINT_KEY) === '1';
  } catch {
    return false;
  }
}

export function markSessionHint(): void {
  try { window.localStorage.setItem(SESSION_HINT_KEY, '1'); } catch { /* storage unavailable */ }
}

export function clearSessionHint(): void {
  try { window.localStorage.removeItem(SESSION_HINT_KEY); } catch { /* storage unavailable */ }
}

// Stored on `window` (not a module var) so it survives across separate island
// bundles: a page (e.g. /login) can request an open before the AuthModal island
// has hydrated, and the island replays it on mount via consumePendingAuthModal.
declare global {
  interface Window {
    __authModalPending?: AuthModalDetail;
  }
}

export function openAuthModal(detail: AuthModalDetail = {}): void {
  window.__authModalPending = detail;
  window.dispatchEvent(new CustomEvent('open-auth-modal', { detail }));
}

export function onOpenAuthModal(cb: (detail: AuthModalDetail) => void): () => void {
  const handler = (e: Event) => {
    window.__authModalPending = undefined; // consumed live; don't replay later
    cb((e as CustomEvent<AuthModalDetail>).detail ?? {});
  };
  window.addEventListener('open-auth-modal', handler);
  return () => window.removeEventListener('open-auth-modal', handler);
}

/** Read + clear a request made before the modal hydrated. Returns undefined if none. */
export function consumePendingAuthModal(): AuthModalDetail | undefined {
  const pending = window.__authModalPending;
  window.__authModalPending = undefined;
  return pending;
}

export function emitSessionChanged(): void {
  window.dispatchEvent(new CustomEvent('session-changed'));
}
