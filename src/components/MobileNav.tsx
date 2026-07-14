import { useEffect, useState } from 'preact/hooks';

const LINKS = [
  { href: '/world-cup', label: 'World Cup' },
  { href: '/floor', label: 'The Floor' },
  { href: '/goats', label: 'Goats' },
  { href: '/rankings', label: 'Rankings' },
  { href: '/faceoff', label: 'Face Off' },
  { href: '/play', label: 'Champion Mode' },
  { href: '/arenas', label: 'All arenas' },
];

export default function MobileNav({ pathname }: { pathname: string }) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open]);

  return (
    <div class="lg:hidden">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        aria-controls="mobile-site-menu"
        aria-label={open ? 'Close navigation' : 'Open navigation'}
        class="h-10 w-10 grid place-items-center rounded-md border border-hairline bg-canvas-soft text-ink"
      >
        <span class="font-mono text-xl leading-none" aria-hidden="true">{open ? '×' : '☰'}</span>
      </button>
      {open && (
        <div id="mobile-site-menu" class="absolute left-5 right-5 top-[52px] z-50 rounded-lg border border-hairline bg-canvas-soft p-2 shadow-2xl">
          <nav aria-label="Mobile navigation" class="grid grid-cols-1 gap-1">
            {LINKS.map((link) => {
              const active = pathname === link.href || pathname.startsWith(`${link.href}/`);
              return (
                <a
                  key={link.href}
                  href={link.href}
                  onClick={() => setOpen(false)}
                  aria-current={active ? 'page' : undefined}
                  class={`rounded-md px-4 py-3 font-headline font-black uppercase tracking-wide transition-colors ${
                    active ? 'bg-canvas-soft-2 text-lime' : 'text-ink hover:bg-canvas-soft-2'
                  }`}
                >
                  {link.label}
                </a>
              );
            })}
          </nav>
        </div>
      )}
    </div>
  );
}
