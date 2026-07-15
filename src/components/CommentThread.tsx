import type { ComponentChildren } from 'preact';
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { useSession } from '../lib/useSession';
import { openAuthModal } from '../lib/authModal';
import { relativeTime } from '../lib/format';
import { MAX_STAT_TAGS } from '../lib/statTags';
import type { TaggableGoat, StatTag, StatTagInput } from '../lib/statTags';
import { subscribeLiveMatch } from '../lib/liveMatchSocket';
import type { LiveMatchEvent } from '../lib/liveMatchProtocol';

/** "Int'l Goals 106" — compact stat display used on chips and picker options. */
function statText(s: { statLabel: string; value: string | number; unit?: string } | { label: string; value: string | number; unit?: string }): string {
  const label = 'statLabel' in s ? s.statLabel : s.label;
  return `${label} ${s.value}${s.unit ? ` ${s.unit}` : ''}`;
}

interface FanTag {
  slug: string;
  label: string;
  bg: string;
  fg: string;
}

interface CommentNode {
  id: number;
  parentId: number | null;
  body: string;
  upvotes: number;
  deleted: boolean;
  createdAt: string;
  authorId: string;
  author: { username: string | null; name: string; image: string | null };
  viewerUpvoted: boolean;
  fanTag: FanTag | null;
  moment: {
    id: number;
    minute: number;
    extra: number | null;
    type: string;
    verificationStatus: 'active' | 'corrected';
  } | null;
  statTags: StatTag[];
}

type CommentSocketEvent = Extract<LiveMatchEvent, {
  type: 'comment.created' | 'comment.deleted' | 'comment.vote';
}>;

function isCommentSocketEvent(event: LiveMatchEvent): event is CommentSocketEvent {
  return event.type === 'comment.created' || event.type === 'comment.deleted' || event.type === 'comment.vote';
}

function applyCommentSocketEvent(current: CommentNode[], event: CommentSocketEvent): CommentNode[] {
  if (event.type === 'comment.created') {
    const incoming = event.payload.comment as CommentNode;
    return current.some((comment) => comment.id === incoming.id) ? current : [...current, incoming];
  }
  if (event.type === 'comment.deleted') {
    return current.map((comment) => comment.id === event.payload.commentId
      ? { ...comment, deleted: true, body: '[deleted]' }
      : comment);
  }
  return current.map((comment) => comment.id === event.payload.commentId
    ? { ...comment, upvotes: event.payload.upvotes }
    : comment);
}

/** Exactly one of battleId / matchId — the discussion subject. */
type SubjectProps =
  | { battleId: string; matchId?: never }
  | { matchId: string; battleId?: never };

type Props = SubjectProps & {
  accentA?: string;
  accentB?: string;
  /** Goats whose stats can be cited in this discussion (composer stat picker). */
  taggableGoats?: TaggableGoat[];
  /** Editorial starting points that focus the existing main composer. */
  prompts?: string[];
  /** Section title shown beside the count (e.g. "The Debate"). Defaults to "Comments". */
  title?: string;
};

type SortMode = 'top' | 'new';

const MAX_DEPTH = 6;

const MOMENT_TYPE_LABEL: Record<string, string> = {
  goal: 'Goal', penalty: 'Penalty', own_goal: 'Own goal', penalty_missed: 'Missed pen',
  yellow_card: 'Yellow card', red_card: 'Red card', foul: 'Foul', handball: 'Handball',
  sub: 'Sub', var: 'VAR', shootout: 'Shootout',
};

/** "23' Penalty" — the human label for a moment anchor. */
function momentLabel(m: { minute: number; extra: number | null; type: string }): string {
  const min = `${m.minute}${m.extra ? `+${m.extra}` : ''}'`;
  return `${min} ${MOMENT_TYPE_LABEL[m.type] ?? m.type.replace(/_/g, ' ')}`;
}

export default function CommentThread({ battleId, matchId, accentA = '#a3e635', accentB = '#a3e635', taggableGoats, prompts = [], title }: Props) {
  // The subject drives the API query param and POST body (battle XOR match).
  const subjectQuery = matchId ? `match=${encodeURIComponent(matchId)}` : `battle=${encodeURIComponent(battleId!)}`;
  const subjectBody: Record<string, string> = matchId ? { matchId } : { battleId: battleId! };
  const { user, loading: sessionLoading } = useSession();
  const [comments, setComments] = useState<CommentNode[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sort, setSort] = useState<SortMode>('top');
  const [activePrompt, setActivePrompt] = useState<string | null>(null);
  const [composerFocusSignal, setComposerFocusSignal] = useState(0);
  // The timeline moment the composer is currently anchored to (match pages only).
  const [activeMoment, setActiveMoment] = useState<{ id: number; label: string } | null>(null);
  // Guards against overlapping vote requests on the same comment, which would
  // otherwise let a stale optimistic flip race the server reply (0→1→0→1 flicker).
  const votingRef = useRef<Set<number>>(new Set());
  // Frozen top-level ordering. Like Reddit, the order is computed on load and on
  // sort change, then held stable as scores change so a vote never makes a
  // comment jump out from under the reader.
  const orderRef = useRef<{ sort: SortMode; ids: number[] }>({ sort, ids: [] });

  useEffect(() => {
    let active = true;
    let refreshPromise: Promise<void> | null = null;
    let bufferedEvents: CommentSocketEvent[] = [];
    const refresh = () => {
      if (refreshPromise) return refreshPromise;
      bufferedEvents = [];
      refreshPromise = (async () => {
        try {
          const response = await fetch(`/api/comments?${subjectQuery}`);
          if (!response.ok) throw new Error('Could not load comments');
          const data = await response.json() as { comments: CommentNode[] };
          if (!active) return;
          const events = bufferedEvents;
          bufferedEvents = [];
          setComments(events.reduce(applyCommentSocketEvent, data.comments));
          setError(null);
        } catch {
          if (!active) return;
          const events = bufferedEvents;
          bufferedEvents = [];
          if (events.length > 0) {
            setComments((current) => events.reduce(applyCommentSocketEvent, current));
          }
          setError('Could not load comments');
        } finally {
          if (active) setLoading(false);
        }
      })().finally(() => { refreshPromise = null; });
      return refreshPromise;
    };
    void refresh();
    const unsubscribeSocket = matchId ? subscribeLiveMatch(matchId, (event) => {
      if (!isCommentSocketEvent(event)) return;
      if (refreshPromise) bufferedEvents.push(event);
      else setComments((current) => applyCommentSocketEvent(current, event));
    }, () => { void refresh(); }) : () => undefined;
    return () => {
      active = false;
      bufferedEvents = [];
      unsubscribeSocket();
    };
  }, [subjectQuery, matchId]);

  // Timeline → composer bridge: the MatchTimeline dispatches `gb:moment` when a
  // moment is clicked; anchor the composer to it (match pages only).
  useEffect(() => {
    if (!matchId) return;
    const onSelect = (e: Event) => {
      const d = (e as CustomEvent).detail;
      if (d && typeof d.id === 'number') setActiveMoment({ id: d.id, label: String(d.label ?? '') });
    };
    window.addEventListener('gb:moment', onSelect);

    // Replay a selection made before this (client:visible) island hydrated, so a
    // moment clicked during load still reaches the composer.
    const selected = document.querySelector<HTMLElement>('.gb-moment.is-active[data-moment-id]');
    const preId = Number(selected?.dataset.momentId);
    if (selected && Number.isFinite(preId)) {
      setActiveMoment({ id: preId, label: selected.dataset.momentLabel ?? '' });
    }

    return () => window.removeEventListener('gb:moment', onSelect);
  }, [matchId]);

  function clearMoment() {
    setActiveMoment(null);
    if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('gb:moment-clear'));
  }

  // Adjacency list → nested tree. Replies stay chronological; the top-level order
  // is frozen (see orderRef) so upvoting doesn't reshuffle the list live.
  const tree = useMemo(() => buildTree(comments, sort, orderRef), [comments, sort]);

  function addComment(node: CommentNode) {
    setComments((prev) => prev.some((comment) => comment.id === node.id) ? prev : [...prev, node]);
  }

  function updateComment(id: number, patch: Partial<CommentNode>) {
    setComments((prev) => prev.map((c) => (c.id === id ? { ...c, ...patch } : c)));
  }

  async function post(
    parentId: number | null,
    body: string,
    momentId: number | null = null,
    statTags: StatTagInput[] = [],
  ): Promise<boolean> {
    if (!user) {
      openAuthModal({ reason: 'Log in to join the discussion' });
      return false;
    }
    try {
      const res = await fetch('/api/comments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...subjectBody,
          parentId,
          body,
          ...(momentId != null ? { momentId } : {}),
          ...(statTags.length ? { statTags } : {}),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? 'Failed to post');
      addComment(data.comment as CommentNode);
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to post');
      return false;
    }
  }

  async function upvote(node: CommentNode) {
    if (!user) {
      openAuthModal({ reason: 'Log in to upvote' });
      return;
    }
    // Ignore repeat clicks while a request for this comment is still in flight.
    if (votingRef.current.has(node.id)) return;
    votingRef.current.add(node.id);

    const remove = node.viewerUpvoted;
    const bump = (delta: number) => (c: CommentNode) =>
      c.id === node.id ? { ...c, upvotes: Math.max(0, c.upvotes + delta) } : c;

    // Optimistic flip — computed from the live state, never the captured node.
    setComments((prev) =>
      prev.map((c) =>
        c.id === node.id ? { ...c, viewerUpvoted: !remove, upvotes: Math.max(0, c.upvotes + (remove ? -1 : 1)) } : c,
      ),
    );
    try {
      const res = await fetch('/api/comment-vote', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ commentId: node.id, remove }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error();
      // Reconcile the exact count without re-toggling the optimistic state.
      setComments((prev) =>
        prev.map((c) => (c.id === node.id ? { ...c, upvotes: data.upvotes, viewerUpvoted: data.viewerUpvoted } : c)),
      );
    } catch {
      // Roll back by reversing the optimistic delta.
      setComments((prev) =>
        prev.map((c) => (c.id === node.id ? { ...bump(remove ? 1 : -1)(c), viewerUpvoted: remove } : c)),
      );
    } finally {
      votingRef.current.delete(node.id);
    }
  }

  async function remove(node: CommentNode) {
    try {
      const res = await fetch('/api/comments', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ commentId: node.id }),
      });
      if (!res.ok) throw new Error();
      updateComment(node.id, { deleted: true, body: '[deleted]' });
    } catch {
      setError('Could not delete comment');
    }
  }

  const count = comments.filter((c) => !c.deleted).length;

  function selectPrompt(prompt: string) {
    setActivePrompt(prompt);
    setComposerFocusSignal((signal) => signal + 1);
    requestAnimationFrame(() => {
      document.getElementById('match-comment-composer')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    });
  }

  return (
    <div>
      {prompts.length > 0 && (
        <section class="mb-7" aria-labelledby="match-prompts-heading">
          <div class="mb-3">
            <p class="font-mono text-[10px] uppercase tracking-[0.14em] text-lime">Start here</p>
            <h2 id="match-prompts-heading" class="mt-1 font-headline font-black uppercase text-xl text-ink">Pick your angle</h2>
            <p class="mt-1 font-sans text-xs text-mute">Tap a prompt to start — your comment stays in the main thread.</p>
          </div>
          <div class="grid grid-cols-1 sm:grid-cols-3 gap-2">
            {prompts.map((prompt, index) => (
              <button
                type="button"
                key={prompt}
                onClick={() => selectPrompt(prompt)}
                aria-pressed={activePrompt === prompt}
                class={`text-left rounded-md border px-3.5 py-3 transition-colors ${
                  activePrompt === prompt
                    ? 'border-lime bg-canvas-soft-2'
                    : 'border-hairline bg-canvas-soft hover:border-hairline-strong'
                }`}
              >
                <span class="font-mono text-[10px] uppercase tracking-[0.12em] text-mute">Prompt {index + 1}</span>
                <span class="block mt-1.5 font-sans text-sm leading-snug text-ink">{prompt}</span>
              </button>
            ))}
          </div>
        </section>
      )}

      {/* Header — count title with sort toggle sitting beside it */}
      <div class="flex flex-wrap items-center gap-x-4 gap-y-3 mb-6">
        <div class="flex items-center gap-3 min-w-0">
          <span
            class="w-1 h-6 inline-block rounded-full shrink-0"
            style={`background:linear-gradient(${accentA}, ${accentB})`}
          />
          <h2 class="font-headline font-black uppercase text-2xl md:text-3xl tracking-tight text-ink flex items-baseline gap-2.5">
            {title ? (
              <>
                <span>{title}</span>
                <span class="text-lime tabular-nums text-xl md:text-2xl">{count}</span>
              </>
            ) : (
              <span><span class="tabular-nums">{count}</span> {count === 1 ? 'Comment' : 'Comments'}</span>
            )}
          </h2>
        </div>

        <div class="inline-flex rounded-md border border-hairline overflow-hidden">
          {(['top', 'new'] as SortMode[]).map((mode) => (
            <button
              key={mode}
              onClick={() => setSort(mode)}
              aria-pressed={sort === mode}
              class={`font-mono font-black uppercase text-lg md:text-base tracking-tight px-3 py-1 transition-colors ${
                sort === mode ? 'bg-canvas-soft-2 text-ink' : 'text-mute hover:text-ink'
              }`}
            >
              {mode === 'top' ? 'Top' : 'Newest'}
            </button>
          ))}
        </div>
      </div>

      {/* Composer */}
      <div id="match-comment-composer">
      {sessionLoading ? (
        // Hold a neutral placeholder until the session resolves so logged-in
        // users don't flash the "Log in to join" prompt.
        <div class="flex gap-3">
          <Avatar src={null} name="?" />
          <div class="flex-1 min-w-0 border-b border-hairline pb-2 h-6 animate-pulse" />
        </div>
      ) : user ? (
        <div>
          {activePrompt && (
            <div class="flex items-start gap-2 mb-2 bg-canvas-soft border border-lime/60 rounded-md px-3 py-2">
              <span class="font-mono text-[10px] uppercase tracking-[0.12em] text-lime shrink-0 pt-0.5">Selected</span>
              <span class="flex-1 font-sans text-[13px] leading-snug text-body">{activePrompt}</span>
              <button
                type="button"
                onClick={() => setActivePrompt(null)}
                class="font-mono text-[11px] text-mute hover:text-ink transition-colors"
                aria-label="Clear selected prompt"
              >
                ✕
              </button>
            </div>
          )}
          {activeMoment && (
            <div class="flex items-center gap-2 mb-2 bg-canvas-soft border border-hairline rounded-md px-3 py-2">
              <span class="team-tag" style={{ '--tag': 'var(--color-lime)', '--tag-fg': '#0d0d0f' }}>⚑ {activeMoment.label}</span>
              <span class="flex-1 font-sans text-[13px] text-mute">Tagging this moment in your comment</span>
              <button
                onClick={clearMoment}
                class="font-mono text-[11px] uppercase tracking-wider text-mute hover:text-ink transition-colors"
                aria-label="Clear moment tag"
              >
                Clear ✕
              </button>
            </div>
          )}
          <Composer
            well
            placeholder={activePrompt ?? (activeMoment ? `Weigh in on ${activeMoment.label}…` : 'Add to the debate…')}
            avatar={<Avatar src={user.image ?? null} name={user.username || user.name} />}
            goats={taggableGoats}
            focusSignal={composerFocusSignal}
            onSubmit={async (body, statTags) => {
              const ok = await post(null, body, activeMoment?.id ?? null, statTags);
              if (ok && activeMoment) clearMoment();
              return ok;
            }}
          />
        </div>
      ) : (
        <div class="flex gap-3">
          <Avatar src={null} name="?" />
          <button
            onClick={() => openAuthModal({ reason: 'Log in to join the discussion' })}
            class="flex-1 min-w-0 text-left border-b border-hairline pb-2 font-sans text-[15px] text-mute hover:border-hairline-strong transition-colors"
          >
            <span class="text-lime font-semibold">Log in</span> to join the discussion
          </button>
        </div>
      )}
      </div>

      {error && <p class="font-mono text-[13px] text-red mt-3">{error}</p>}

      {/* Thread — contained scroll so opening a reply never shifts the sections below */}
      <div
        class={`mt-6 overflow-y-auto overflow-x-hidden pr-2 ${
          !loading && count > 0 ? 'h-[32rem] md:h-[36rem]' : ''
        }`}
      >
        {loading ? (
          <div class="space-y-6">
            {[0, 1, 2].map((i) => (
              <div key={i} class="flex gap-3 animate-pulse">
                <div class="h-10 w-10 rounded-full bg-canvas-soft shrink-0" />
                <div class="flex-1 space-y-2 pt-1">
                  <div class="h-3 w-32 rounded bg-canvas-soft" />
                  <div class="h-3 w-3/4 rounded bg-canvas-soft" />
                </div>
              </div>
            ))}
          </div>
        ) : count === 0 ? (
          <p class="font-mono text-[13px] uppercase tracking-widest text-mute py-6">
            Be the first to weigh in
          </p>
        ) : (
          <div class="space-y-7">
            {tree.map((node) => (
              <CommentItem
                key={node.id}
                node={node}
                depth={0}
                viewerId={user?.id ?? null}
                onUpvote={upvote}
                onReply={post}
                onDelete={remove}
                goats={taggableGoats}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Avatar ─────────────────────────────────────────────────────────────────

function Avatar({ src, name, small = false }: { src: string | null; name: string; small?: boolean }) {
  const size = small ? 'h-8 w-8' : 'h-10 w-10';
  if (src) {
    return <img src={src} alt="" class={`${size} rounded-full object-cover shrink-0`} />;
  }
  const initial = (name.trim()[0] ?? '?').toUpperCase();
  return (
    <div
      class={`${size} shrink-0 rounded-full bg-canvas-soft-2 border border-hairline grid place-items-center font-headline font-black uppercase ${
        small ? 'text-sm' : 'text-lg'
      } text-ink`}
      aria-hidden="true"
    >
      {initial}
    </div>
  );
}

// ─── Tree node ────────────────────────────────────────────────────────────────

interface TreeNode extends CommentNode {
  children: TreeNode[];
}

function buildTree(
  flat: CommentNode[],
  sort: SortMode,
  orderRef: { current: { sort: SortMode; ids: number[] } },
): TreeNode[] {
  const byId = new Map<number, TreeNode>();
  flat.forEach((c) => byId.set(c.id, { ...c, children: [] }));
  const roots: TreeNode[] = [];
  byId.forEach((node) => {
    if (node.parentId !== null && byId.has(node.parentId)) {
      byId.get(node.parentId)!.children.push(node);
    } else {
      roots.push(node);
    }
  });

  // Replies always stay chronological — they never reorder on a vote.
  const sortReplies = (n: TreeNode) => {
    n.children.sort((a, b) => +new Date(a.createdAt) - +new Date(b.createdAt));
    n.children.forEach(sortReplies);
  };
  roots.forEach(sortReplies);

  // Top-level order is frozen. We only compute a fresh sort on the first build
  // or when the sort mode changes; otherwise we preserve the established order,
  // dropping removed comments and surfacing brand-new ones at the top. This is
  // how Reddit keeps a comment from jumping when its score changes.
  const rootById = new Map(roots.map((r) => [r.id, r]));
  const freshSort = () =>
    [...roots].sort((a, b) =>
      sort === 'new'
        ? +new Date(b.createdAt) - +new Date(a.createdAt)
        : b.upvotes - a.upvotes || +new Date(b.createdAt) - +new Date(a.createdAt),
    );

  const prev = orderRef.current;
  let orderedIds: number[];
  if (prev.sort !== sort || prev.ids.length === 0) {
    orderedIds = freshSort().map((r) => r.id);
  } else {
    const kept = prev.ids.filter((id) => rootById.has(id));
    const keptSet = new Set(kept);
    const added = roots.filter((r) => !keptSet.has(r.id)).map((r) => r.id);
    orderedIds = [...added, ...kept];
  }
  orderRef.current = { sort, ids: orderedIds };

  return orderedIds.map((id) => rootById.get(id)).filter((n): n is TreeNode => !!n);
}

function CommentItem({
  node,
  depth,
  viewerId,
  onUpvote,
  onReply,
  onDelete,
  goats,
}: {
  node: TreeNode;
  depth: number;
  viewerId: string | null;
  onUpvote: (n: CommentNode) => void;
  onReply: (parentId: number | null, body: string, momentId?: number | null, statTags?: StatTagInput[]) => Promise<boolean>;
  onDelete: (n: CommentNode) => void;
  goats?: TaggableGoat[];
}) {
  const [replying, setReplying] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const isAuthor = !!viewerId && node.authorId === viewerId;
  const replyCount = countDescendants(node);
  const displayName = node.author.username ?? node.author.name;
  const isReply = depth > 0;

  // Geometry for the Reddit-style bent connectors drawn between this comment and its replies.
  const avatarSize = isReply ? 32 : 40; // px — matches Avatar's h-8 / h-10
  const avatarCenter = avatarSize / 2;
  const gutter = avatarCenter + 18; // horizontal reach of each elbow = per-level indent
  const REPLY_AVATAR_CENTER = 16; // replies always render the small (h-8) avatar
  const hasKids = !collapsed && node.children.length > 0;

  return (
    <div>
      <article class="flex gap-3">
        {/* Avatar column — the trunk line drops from here down to the first reply */}
        <div class="flex flex-col items-center shrink-0" style={{ width: `${avatarSize}px` }}>
          <Avatar src={node.author.image} name={displayName} small={isReply} />
          {hasKids && <div class="w-0.5 flex-1 bg-hairline mt-2" />}
        </div>

        <div class={`flex-1 min-w-0 ${hasKids ? 'pb-3' : ''}`}>
          {/* Meta */}
          <div class="flex items-center gap-2 mb-1">
            {node.fanTag && (
              <a
                href={`/goats/${node.fanTag.slug}`}
                class="team-tag"
                style={{ '--tag': node.fanTag.bg, '--tag-fg': node.fanTag.fg }}
                title={`Backs ${node.fanTag.label}`}
              >
                {node.fanTag.label}
              </a>
            )}
            {node.author.username ? (
              <a
                href={`/users/${node.author.username}`}
                class="font-sans font-semibold text-[13px] text-ink hover:text-lime transition-colors"
              >
                @{node.author.username}
              </a>
            ) : (
              <span class="font-sans font-semibold text-[13px] text-mute">{node.author.name}</span>
            )}
            <span class="font-mono text-[11px] text-mute">· {relativeTime(node.createdAt)}</span>
          </div>

          {/* Moment tag — a citation chip linking the comment to a timeline point */}
          {node.moment && node.moment.verificationStatus === 'active' && (
            <button
              type="button"
              onClick={() =>
                window.dispatchEvent(
                  new CustomEvent('gb:moment', {
                    detail: { id: node.moment!.id, label: momentLabel(node.moment!) },
                  }),
                )
              }
              class="inline-flex items-center gap-1.5 mb-2 rounded-md border border-lime/40 bg-lime/[0.07] px-2.5 py-1 hover:border-lime transition-colors"
              title="Highlight this moment on the timeline"
            >
              <span class="text-[11px] leading-none">🚩</span>
              <span class="font-headline font-extrabold uppercase tracking-wide text-[12px] text-lime leading-none">{momentLabel(node.moment)}</span>
            </button>
          )}
          {node.moment && node.moment.verificationStatus === 'corrected' && (
            <span class="inline-flex items-center gap-1.5 mb-2 rounded-md border border-red/40 bg-red/[0.07] px-2.5 py-1 font-headline font-extrabold uppercase tracking-wide text-[12px] text-red leading-none">
              Source corrected · {momentLabel(node.moment)}
            </span>
          )}

          {/* Stat citations — definitive goat stats backing the argument */}
          {node.statTags.length > 0 && (
            <div class="flex flex-wrap gap-1.5 mb-1.5">
              {node.statTags.map((t) => (
                <a
                  key={`${t.goatSlug}-${t.statLabel}`}
                  href={`/goats/${t.goatSlug}`}
                  class="inline-flex items-center gap-1.5 bg-canvas-soft border border-hairline rounded-md px-2.5 py-1 font-mono text-[11px] text-ink hover:border-lime transition-colors"
                  title={`${t.goatShortName} — ${statText(t)} (from the stat sheet)`}
                >
                  <span class="text-lime">⚡</span>
                  <span class="font-semibold">{t.goatShortName}</span>
                  <span class="text-mute">· {statText(t)}</span>
                </a>
              ))}
            </div>
          )}

          {/* Body */}
          <p
            class={`font-sans text-[16px] leading-relaxed whitespace-pre-wrap break-words ${
              node.deleted ? 'text-mute italic' : 'text-body'
            }`}
          >
            {node.body}
          </p>

          {/* Actions */}
          <div class="flex items-center gap-5 mt-2">
            <button
              onClick={() => onUpvote(node)}
              disabled={node.deleted}
              class={`flex items-center gap-1.5 font-mono text-[13px] transition-colors disabled:opacity-40 ${
                node.viewerUpvoted ? 'text-lime' : 'text-mute hover:text-ink'
              }`}
            >
              ▲ {node.upvotes}
            </button>
            {!node.deleted && depth < MAX_DEPTH && (
              <button
                onClick={() => setReplying((r) => !r)}
                class="font-mono text-[13px] text-mute hover:text-ink transition-colors"
              >
                Reply
              </button>
            )}
            {isAuthor && !node.deleted && (
              <button
                onClick={() => onDelete(node)}
                class="font-mono text-[13px] text-mute hover:text-red transition-colors"
              >
                Delete
              </button>
            )}
            {!isAuthor && !node.deleted && (
              <ReportControl commentId={node.id} authenticated={!!viewerId} />
            )}
            {replyCount > 0 && (
              <button
                onClick={() => setCollapsed((c) => !c)}
                class="font-mono text-[13px] text-lime hover:text-lime-dark transition-colors"
              >
                {collapsed ? `▾ ${replyCount} ${replyCount === 1 ? 'reply' : 'replies'}` : '▴ Hide'}
              </button>
            )}
          </div>

          {replying && (
            <div class="mt-3">
              <Composer
                placeholder={`Reply to ${displayName}…`}
                compact
                autoFocus
                goats={goats}
                onCancel={() => setReplying(false)}
                onSubmit={async (body, statTags) => {
                  const ok = await onReply(node.id, body, null, statTags);
                  if (ok) setReplying(false);
                  return ok;
                }}
              />
            </div>
          )}

        </div>
      </article>

      {/* Replies — Reddit-style bent (elbow) connectors */}
      {hasKids && (
        <div class="flex flex-col">
          {node.children.map((child, i) => {
            const last = i === node.children.length - 1;
            return (
              <div class={`relative flex ${last ? '' : 'pb-6'}`} key={child.id}>
                {/* Straight trunk to the next sibling — spans the full row incl. the pb gap */}
                {!last && (
                  <span
                    class="absolute bg-hairline pointer-events-none"
                    style={{ left: `${avatarCenter - 1}px`, top: 0, bottom: 0, width: '2px' }}
                  />
                )}
                {/* Elbow: drops from the trunk, then bends right into the reply's avatar */}
                <span
                  class="absolute border-l-2 border-b-2 border-hairline rounded-bl-[12px] pointer-events-none"
                  style={{
                    left: `${avatarCenter - 1}px`,
                    top: 0,
                    width: `${gutter - avatarCenter + 1}px`,
                    height: `${REPLY_AVATAR_CENTER + 1}px`,
                  }}
                />
                <div class="shrink-0" style={{ width: `${gutter}px` }} />
                <div class="flex-1 min-w-0">
                  <CommentItem
                    node={child}
                    depth={depth + 1}
                    viewerId={viewerId}
                    onUpvote={onUpvote}
                    onReply={onReply}
                    onDelete={onDelete}
                    goats={goats}
                  />
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function countDescendants(node: TreeNode): number {
  return node.children.reduce((sum, c) => sum + 1 + countDescendants(c), 0);
}

type ReportReason = 'spam' | 'harassment' | 'hate' | 'privacy' | 'misinformation' | 'other';

function ReportControl({ commentId, authenticated }: { commentId: number; authenticated: boolean }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState<ReportReason | ''>('');
  const [details, setDetails] = useState('');
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  function begin() {
    if (!authenticated) {
      openAuthModal({ reason: 'Log in to report a comment' });
      return;
    }
    setOpen((value) => !value);
    setMessage(null);
  }

  async function submit() {
    if (!reason || pending) return;
    setPending(true);
    setMessage(null);
    try {
      const response = await fetch('/api/comment-reports', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ commentId, reason, ...(details.trim() ? { details: details.trim() } : {}) }),
      });
      const data = await response.json() as { error?: string };
      if (!response.ok) throw new Error(data.error ?? 'Could not submit report');
      setMessage('Report submitted for review.');
      setReason('');
      setDetails('');
      setOpen(false);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Could not submit report');
    } finally {
      setPending(false);
    }
  }

  return (
    <div class="relative">
      <button
        type="button"
        onClick={begin}
        class="font-mono text-[13px] text-mute hover:text-red transition-colors"
        aria-expanded={open}
      >
        Report
      </button>
      {message && !open && <span class="ml-2 font-mono text-[11px] text-mute">{message}</span>}
      {open && (
        <div class="absolute right-0 top-7 z-20 w-[min(20rem,calc(100vw-3rem))] rounded-md border border-hairline bg-canvas-soft p-3 shadow-2xl">
          <p class="font-headline font-black uppercase text-lg text-ink">Report comment</p>
          <label class="block mt-2 font-mono text-[10px] uppercase tracking-[0.12em] text-mute" for={`report-reason-${commentId}`}>Reason</label>
          <select
            id={`report-reason-${commentId}`}
            value={reason}
            onChange={(event) => setReason((event.target as HTMLSelectElement).value as ReportReason | '')}
            class="mt-1 w-full rounded-sm border border-hairline bg-canvas px-2 py-2 font-sans text-sm text-ink"
          >
            <option value="">Choose a reason…</option>
            <option value="spam">Spam or manipulation</option>
            <option value="harassment">Harassment or threats</option>
            <option value="hate">Hateful conduct</option>
            <option value="privacy">Privacy or personal information</option>
            <option value="misinformation">Dangerous misinformation</option>
            <option value="other">Other rule violation</option>
          </select>
          <label class="block mt-2 font-mono text-[10px] uppercase tracking-[0.12em] text-mute" for={`report-details-${commentId}`}>Details (optional)</label>
          <textarea
            id={`report-details-${commentId}`}
            value={details}
            maxLength={1000}
            rows={3}
            onInput={(event) => setDetails((event.target as HTMLTextAreaElement).value)}
            class="mt-1 w-full resize-y rounded-sm border border-hairline bg-canvas px-2 py-2 font-sans text-sm text-ink"
          />
          {message && <p class="mt-2 font-mono text-[11px] text-red">{message}</p>}
          <div class="mt-3 flex justify-end gap-2">
            <button type="button" onClick={() => setOpen(false)} class="btn btn-secondary text-xs px-3 py-2">Cancel</button>
            <button type="button" onClick={submit} disabled={!reason || pending} class="btn btn-primary text-xs px-3 py-2 disabled:opacity-40">
              {pending ? 'Submitting…' : 'Submit report'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Composer ─────────────────────────────────────────────────────────────────

function Composer({
  placeholder,
  onSubmit,
  onCancel,
  avatar,
  compact = false,
  autoFocus = false,
  goats,
  focusSignal = 0,
  well = false,
}: {
  placeholder: string;
  onSubmit: (body: string, statTags: StatTagInput[]) => Promise<boolean>;
  onCancel?: () => void;
  avatar?: ComponentChildren;
  compact?: boolean;
  autoFocus?: boolean;
  goats?: TaggableGoat[];
  focusSignal?: number;
  /** Render as a sunken well (design §5) — used for the main match/battle composer. */
  well?: boolean;
}) {
  const [value, setValue] = useState('');
  const [pending, setPending] = useState(false);
  const [tags, setTags] = useState<StatTag[]>([]);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickGoat, setPickGoat] = useState('');
  const [pickStat, setPickStat] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const canTagStats = !!goats && goats.length > 0;
  const activeGoat = goats?.find((g) => g.slug === (pickGoat || goats[0]?.slug));

  // Auto-grow to fit the content, capped so it never runs away.
  const MAX_HEIGHT = 220;
  function autoGrow(el: HTMLTextAreaElement | null) {
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, MAX_HEIGHT)}px`;
    el.style.overflowY = el.scrollHeight > MAX_HEIGHT ? 'auto' : 'hidden';
  }

  useEffect(() => {
    autoGrow(textareaRef.current);
  }, [value]);

  useEffect(() => {
    if (focusSignal <= 0) return;
    textareaRef.current?.focus();
    textareaRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, [focusSignal]);

  function addTag() {
    if (!activeGoat || !pickStat || tags.length >= MAX_STAT_TAGS) return;
    const stat = activeGoat.stats.find((s) => s.label === pickStat);
    if (!stat) return;
    if (tags.some((t) => t.goatSlug === activeGoat.slug && t.statLabel === stat.label)) return;
    setTags((prev) => [
      ...prev,
      { goatSlug: activeGoat.slug, goatShortName: activeGoat.shortName, statLabel: stat.label, value: stat.value, ...(stat.unit ? { unit: stat.unit } : {}) },
    ]);
    setPickStat('');
  }

  function removeTag(i: number) {
    setTags((prev) => prev.filter((_, idx) => idx !== i));
  }

  async function submit() {
    const body = value.trim();
    if (!body || pending) return;
    setPending(true);
    const ok = await onSubmit(body, tags.map((t) => ({ goatSlug: t.goatSlug, statLabel: t.statLabel })));
    setPending(false);
    if (ok) {
      setValue('');
      setTags([]);
      setPickerOpen(false);
    }
  }

  function cancel() {
    setValue('');
    setTags([]);
    setPickerOpen(false);
    textareaRef.current?.blur();
    onCancel?.();
  }

  // Show Cancel on replies (to close them) and on the main composer once typing has started.
  const showCancel = !!onCancel || value.length > 0 || tags.length > 0;

  return (
    <div class="flex gap-3">
      {avatar}
      <div class={`flex-1 min-w-0 ${well ? 'bg-sunken border border-hairline rounded-md px-4 py-3.5 focus-within:border-lime/50 transition-colors' : ''}`}>
        <textarea
          ref={textareaRef}
          value={value}
          placeholder={placeholder}
          rows={1}
          autoFocus={autoFocus}
          onInput={(e) => setValue((e.target as HTMLTextAreaElement).value)}
          onKeyDown={(e) => {
            if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') submit();
            if (e.key === 'Escape') cancel();
          }}
          class={`w-full bg-transparent border-0 rounded-none px-0 text-ink font-sans text-[16px] leading-relaxed resize-none placeholder:text-mute focus:outline-none transition-colors ${well ? 'py-0' : 'border-b border-hairline py-2 focus:border-lime'}`}
        />

        {/* Pending stat tags */}
        {tags.length > 0 && (
          <div class="flex flex-wrap gap-1.5 mt-2">
            {tags.map((t, i) => (
              <span key={`${t.goatSlug}-${t.statLabel}`} class="inline-flex items-center gap-1 bg-canvas-soft border border-hairline rounded-sm px-2 py-0.5 font-mono text-[11px] text-ink">
                <span class="text-lime">⚡</span>
                <span class="font-semibold">{t.goatShortName}</span>
                <span class="text-mute">· {statText(t)}</span>
                <button onClick={() => removeTag(i)} class="text-mute hover:text-red ml-0.5" aria-label="Remove stat">✕</button>
              </span>
            ))}
          </div>
        )}

        {/* Stat picker */}
        {canTagStats && pickerOpen && (
          <div class="flex flex-wrap items-center gap-2 mt-2 bg-canvas-soft border border-hairline rounded-md p-2">
            <select
              aria-label="Goat"
              value={pickGoat || goats![0].slug}
              onChange={(e) => { setPickGoat((e.target as HTMLSelectElement).value); setPickStat(''); }}
              class="bg-canvas border border-hairline rounded-sm px-2 py-1 font-sans text-[13px] text-ink focus:outline-none focus:border-lime"
            >
              {goats!.map((g) => <option value={g.slug} key={g.slug}>{g.shortName}</option>)}
            </select>
            <select
              aria-label="Statistic"
              value={pickStat}
              onChange={(e) => setPickStat((e.target as HTMLSelectElement).value)}
              class="flex-1 min-w-[10rem] bg-canvas border border-hairline rounded-sm px-2 py-1 font-sans text-[13px] text-ink focus:outline-none focus:border-lime"
            >
              <option value="">Choose a stat…</option>
              {activeGoat?.stats.map((s) => <option value={s.label} key={s.label}>{statText(s)}</option>)}
            </select>
            <button
              onClick={addTag}
              disabled={!pickStat || tags.length >= MAX_STAT_TAGS}
              class="font-headline font-black uppercase tracking-wider text-[13px] text-lime hover:text-lime-dark px-2 h-8 disabled:opacity-40"
            >
              Add
            </button>
          </div>
        )}

        <div class={`flex justify-end items-center gap-2 ${well ? 'mt-3 border-t border-hairline pt-3' : 'mt-2'}`}>
          {canTagStats && (
            <button
              onClick={() => setPickerOpen((o) => !o)}
              disabled={tags.length >= MAX_STAT_TAGS}
              class={`mr-auto font-mono text-[12px] uppercase tracking-wider transition-colors disabled:opacity-40 ${pickerOpen ? 'text-lime' : 'text-mute hover:text-ink'}`}
              title="Cite a definitive goat stat"
            >
              ⚡ Cite a stat
            </button>
          )}
          {showCancel && (
            <button
              onClick={cancel}
              disabled={pending}
              class="font-headline font-black uppercase tracking-wider text-sm text-mute hover:text-ink px-4 h-9 rounded-sm transition-colors disabled:opacity-40"
            >
              Cancel
            </button>
          )}
          <button
            onClick={submit}
            disabled={pending || value.trim().length === 0}
            class="font-headline font-black uppercase tracking-wider text-sm bg-lime text-canvas px-5 h-9 rounded-sm hover:bg-lime-dark transition-colors disabled:opacity-40"
          >
            {pending ? '…' : compact ? 'Reply' : 'Post'}
          </button>
        </div>
      </div>
    </div>
  );
}
