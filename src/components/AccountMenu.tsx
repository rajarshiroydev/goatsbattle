import { useEffect, useRef, useState } from 'preact/hooks';
import { authClient } from '../lib/authClient';
import { useSession } from '../lib/useSession';
import { openAuthModal, emitSessionChanged } from '../lib/authModal';

export default function AccountMenu() {
  const { user, loading } = useSession();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener('click', onClick);
    return () => window.removeEventListener('click', onClick);
  }, [open]);

  async function logout() {
    await authClient.signOut();
    emitSessionChanged();
    setOpen(false);
  }

  if (loading && !user) {
    return <div class="w-10 h-10 rounded-full bg-canvas-soft-2 animate-pulse" aria-hidden="true" />;
  }

  if (!user) {
    return (
      <button
        onClick={() => openAuthModal()}
        class="font-sans font-medium text-base text-body hover:text-ink px-3 h-10 flex items-center rounded-md hover:bg-canvas-soft transition-colors"
      >
        Log in
      </button>
    );
  }

  const initial = (user.username ?? user.name ?? '?').charAt(0).toUpperCase();

  return (
    <div class="relative" ref={ref}>
      <button
        onClick={() => setOpen((o) => !o)}
        class="w-10 h-10 rounded-full bg-lime text-canvas font-headline font-black text-lg flex items-center justify-center hover:bg-lime-dark transition-colors overflow-hidden"
        aria-label="Account menu"
      >
        {user.image ? (
          <img src={user.image} alt="" class="w-full h-full object-cover" />
        ) : (
          initial
        )}
      </button>

      {open && (
        <div class="absolute right-0 mt-2 w-52 bg-canvas-soft border border-hairline-strong rounded-md py-1.5 shadow-xl">
          <div class="px-4 py-2 border-b border-hairline">
            <p class="font-headline font-black uppercase text-sm text-ink truncate">
              {user.username ?? user.name}
            </p>
            <p class="font-mono text-[11px] text-mute truncate">{user.email}</p>
          </div>
          {user.username && (
            <a
              href={`/users/${user.username}`}
              class="block px-4 py-2 font-sans text-sm text-body hover:text-ink hover:bg-canvas-soft-2 transition-colors"
            >
              My profile
            </a>
          )}
          <button
            onClick={logout}
            class="w-full text-left px-4 py-2 font-sans text-sm text-body hover:text-ink hover:bg-canvas-soft-2 transition-colors"
          >
            Log out
          </button>
        </div>
      )}
    </div>
  );
}
