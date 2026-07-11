import { useEffect, useRef, useState } from 'preact/hooks';
import { authClient } from '../lib/authClient';
import { onOpenAuthModal, emitSessionChanged, consumePendingAuthModal } from '../lib/authModal';

interface Props {
  /** Whether Google OAuth is configured server-side (hides the button if not). */
  googleEnabled?: boolean;
}

type Mode = 'signin' | 'signup';

export default function AuthModal({ googleEnabled = false }: Props) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState<string | null>(null);
  const [mode, setMode] = useState<Mode>('signin');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const apply = (detail: { reason?: string; mode?: 'signin' | 'signup' }) => {
      setReason(detail.reason ?? null);
      if (detail.mode) setMode(detail.mode);
      setError(null);
      setOpen(true);
    };
    const unsub = onOpenAuthModal(apply);
    // Replay a request fired before this island hydrated (e.g. /login auto-open).
    const pendingOpen = consumePendingAuthModal();
    if (pendingOpen) apply(pendingOpen);
    return unsub;
  }, []);

  // Close on Escape.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  // Initial focus + trap Tab within the dialog while open.
  useEffect(() => {
    if (!open) return;
    const node = dialogRef.current;
    if (!node) return;
    const prev = document.activeElement as HTMLElement | null;
    const focusables = () =>
      Array.from(
        node.querySelectorAll<HTMLElement>(
          'a[href],button,textarea,input,select,[tabindex]:not([tabindex="-1"])',
        ),
      ).filter((el) => !el.hasAttribute('disabled'));
    (focusables()[0] ?? node).focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Tab') return;
      const items = focusables();
      if (items.length === 0) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    node.addEventListener('keydown', onKey);
    return () => {
      node.removeEventListener('keydown', onKey);
      prev?.focus?.();
    };
  }, [open]);

  function close() {
    setOpen(false);
    setError(null);
  }

  async function submit(e: Event) {
    e.preventDefault();
    if (pending) return;
    setPending(true);
    setError(null);
    try {
      const res =
        mode === 'signup'
          ? await authClient.signUp.email({ email, password, name })
          : await authClient.signIn.email({ email, password });
      if (res.error) throw new Error(res.error.message ?? 'Something went wrong');
      emitSessionChanged();
      close();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
    } finally {
      setPending(false);
    }
  }

  async function google() {
    setError(null);
    try {
      await authClient.signIn.social({ provider: 'google', callbackURL: window.location.href });
    } catch {
      setError('Google sign-in failed');
    }
  }

  if (!open) return null;

  const isSignup = mode === 'signup';

  return (
    <div
      class="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-canvas/80 backdrop-blur-sm"
      onClick={(e) => e.target === e.currentTarget && close()}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="auth-modal-title"
        tabIndex={-1}
        class="w-full max-w-md bg-canvas-soft border border-hairline-strong rounded-lg p-7 relative focus:outline-none"
      >
        <button
          onClick={close}
          aria-label="Close"
          class="absolute top-4 right-4 text-mute hover:text-ink text-xl leading-none"
        >
          ✕
        </button>

        <h2 id="auth-modal-title" class="font-headline font-black uppercase tracking-tight text-3xl text-ink">
          {isSignup ? 'Join GOATSBattle' : 'Welcome back'}
        </h2>
        <p class="font-mono text-[13px] uppercase tracking-widest text-mute mt-1.5">
          {reason ?? (isSignup ? 'Create an account to vote & debate' : 'Log in to your account')}
        </p>

        {googleEnabled && (
          <>
            <button
              onClick={google}
              class="mt-6 w-full h-12 flex items-center justify-center gap-2.5 rounded-sm bg-ink text-canvas font-headline font-black uppercase tracking-wider text-base hover:opacity-90 transition-opacity"
            >
              <span class="text-lg">G</span> Continue with Google
            </button>
            <div class="flex items-center gap-3 my-5">
              <span class="h-px flex-1 bg-hairline"></span>
              <span class="font-mono text-[11px] uppercase tracking-widest text-mute">or</span>
              <span class="h-px flex-1 bg-hairline"></span>
            </div>
          </>
        )}

        <form onSubmit={submit} class={googleEnabled ? '' : 'mt-6'}>
          {isSignup && (
            <label class="block mb-3">
              <span class="font-mono text-[11px] uppercase tracking-widest text-mute">Display name</span>
              <input
                type="text"
                required
                value={name}
                onInput={(e) => setName((e.target as HTMLInputElement).value)}
                class="mt-1 w-full h-11 px-3 bg-canvas-soft-2 border border-hairline rounded-sm text-ink font-sans focus:outline-none focus:border-lime"
              />
            </label>
          )}
          <label class="block mb-3">
            <span class="font-mono text-[11px] uppercase tracking-widest text-mute">Email</span>
            <input
              type="email"
              required
              value={email}
              onInput={(e) => setEmail((e.target as HTMLInputElement).value)}
              class="mt-1 w-full h-11 px-3 bg-canvas-soft-2 border border-hairline rounded-sm text-ink font-sans focus:outline-none focus:border-lime"
            />
          </label>
          <label class="block mb-4">
            <span class="font-mono text-[11px] uppercase tracking-widest text-mute">Password</span>
            <input
              type="password"
              required
              minLength={isSignup ? 10 : undefined}
              value={password}
              onInput={(e) => setPassword((e.target as HTMLInputElement).value)}
              class="mt-1 w-full h-11 px-3 bg-canvas-soft-2 border border-hairline rounded-sm text-ink font-sans focus:outline-none focus:border-lime"
            />
          </label>

          {error && (
            <p class="font-mono text-[13px] text-red mb-3">{error}</p>
          )}

          <button
            type="submit"
            disabled={pending}
            class="w-full h-12 rounded-sm bg-lime text-canvas font-headline font-black uppercase tracking-wider text-lg hover:bg-lime-dark transition-colors disabled:opacity-50"
          >
            {pending ? '…' : isSignup ? 'Create account' : 'Log in'}
          </button>
        </form>

        <p class="text-center font-sans text-sm text-body mt-5">
          {isSignup ? 'Already have an account?' : 'New to GOATSBattle?'}{' '}
          <button
            onClick={() => {
              setMode(isSignup ? 'signin' : 'signup');
              setError(null);
            }}
            class="text-lime font-semibold hover:underline"
          >
            {isSignup ? 'Log in' : 'Sign up'}
          </button>
        </p>
      </div>
    </div>
  );
}
