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

export function openAuthModal(detail: AuthModalDetail = {}): void {
  window.dispatchEvent(new CustomEvent('open-auth-modal', { detail }));
}

export function onOpenAuthModal(cb: (detail: AuthModalDetail) => void): () => void {
  const handler = (e: Event) => cb((e as CustomEvent<AuthModalDetail>).detail ?? {});
  window.addEventListener('open-auth-modal', handler);
  return () => window.removeEventListener('open-auth-modal', handler);
}

export function emitSessionChanged(): void {
  window.dispatchEvent(new CustomEvent('session-changed'));
}
