import { useState } from 'preact/hooks';

interface Props {
  title: string;
  text: string;
}

export default function ShareButton({ title, text }: Props) {
  const [state, setState] = useState<'idle' | 'shared' | 'copied' | 'error'>('idle');

  async function share() {
    const url = window.location.href;
    try {
      if (navigator.share) {
        await navigator.share({ title, text, url });
        setState('shared');
      } else {
        await navigator.clipboard.writeText(url);
        setState('copied');
      }
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return;
      try {
        await navigator.clipboard.writeText(url);
        setState('copied');
      } catch {
        setState('error');
      }
    }
    window.setTimeout(() => setState('idle'), 2200);
  }

  const label = state === 'shared'
    ? 'Shared'
    : state === 'copied'
      ? 'Link copied'
      : state === 'error'
        ? 'Copy failed'
        : 'Share match';

  return (
    <button type="button" onClick={share} class="btn btn-secondary text-sm px-4 py-2" aria-live="polite">
      {state === 'idle' ? '↗ ' : ''}{label}
    </button>
  );
}
