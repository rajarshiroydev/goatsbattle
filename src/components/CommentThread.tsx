import type { ComponentChildren } from 'preact';
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { useSession } from '../lib/useSession';
import { openAuthModal } from '../lib/authModal';
import { relativeTime } from '../lib/format';

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
}

/** Exactly one of battleId / matchId — the discussion subject. */
type SubjectProps =
  | { battleId: string; matchId?: never }
  | { matchId: string; battleId?: never };

type Props = SubjectProps & {
  accentA?: string;
  accentB?: string;
};

type SortMode = 'top' | 'new';

const MAX_DEPTH = 6;

export default function CommentThread({ battleId, matchId, accentA = '#a3e635', accentB = '#a3e635' }: Props) {
  // The subject drives the API query param and POST body (battle XOR match).
  const subjectQuery = matchId ? `match=${encodeURIComponent(matchId)}` : `battle=${encodeURIComponent(battleId!)}`;
  const subjectBody: Record<string, string> = matchId ? { matchId } : { battleId: battleId! };
  const { user, loading: sessionLoading } = useSession();
  const [comments, setComments] = useState<CommentNode[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sort, setSort] = useState<SortMode>('top');
  // Guards against overlapping vote requests on the same comment, which would
  // otherwise let a stale optimistic flip race the server reply (0→1→0→1 flicker).
  const votingRef = useRef<Set<number>>(new Set());
  // Frozen top-level ordering. Like Reddit, the order is computed on load and on
  // sort change, then held stable as scores change so a vote never makes a
  // comment jump out from under the reader.
  const orderRef = useRef<{ sort: SortMode; ids: number[] }>({ sort, ids: [] });

  useEffect(() => {
    let active = true;
    fetch(`/api/comments?${subjectQuery}`)
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((data: { comments: CommentNode[] }) => active && setComments(data.comments))
      .catch(() => active && setError('Could not load comments'))
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
    };
  }, [subjectQuery]);

  // Adjacency list → nested tree. Replies stay chronological; the top-level order
  // is frozen (see orderRef) so upvoting doesn't reshuffle the list live.
  const tree = useMemo(() => buildTree(comments, sort, orderRef), [comments, sort]);

  function addComment(node: CommentNode) {
    setComments((prev) => [...prev, node]);
  }

  function updateComment(id: number, patch: Partial<CommentNode>) {
    setComments((prev) => prev.map((c) => (c.id === id ? { ...c, ...patch } : c)));
  }

  async function post(parentId: number | null, body: string): Promise<boolean> {
    if (!user) {
      openAuthModal({ reason: 'Log in to join the discussion' });
      return false;
    }
    try {
      const res = await fetch('/api/comments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...subjectBody, parentId, body }),
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

  return (
    <div>
      {/* Header — count title with sort toggle sitting beside it */}
      <div class="flex flex-wrap items-center gap-x-4 gap-y-3 mb-6">
        <div class="flex items-center gap-3 min-w-0">
          <span
            class="w-1 h-6 inline-block rounded-full shrink-0"
            style={`background:linear-gradient(${accentA}, ${accentB})`}
          />
          <h2 class="font-headline font-black uppercase text-2xl md:text-3xl tracking-tight text-ink">
            <span class="tabular-nums">{count}</span> {count === 1 ? 'Comment' : 'Comments'}
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
      {sessionLoading ? (
        // Hold a neutral placeholder until the session resolves so logged-in
        // users don't flash the "Log in to join" prompt.
        <div class="flex gap-3">
          <Avatar src={null} name="?" />
          <div class="flex-1 min-w-0 border-b border-hairline pb-2 h-6 animate-pulse" />
        </div>
      ) : user ? (
        <Composer
          placeholder="Add to the debate…"
          avatar={<Avatar src={user.image ?? null} name={user.username || user.name} />}
          onSubmit={(body) => post(null, body)}
        />
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
}: {
  node: TreeNode;
  depth: number;
  viewerId: string | null;
  onUpvote: (n: CommentNode) => void;
  onReply: (parentId: number | null, body: string) => Promise<boolean>;
  onDelete: (n: CommentNode) => void;
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
                class="font-headline font-black uppercase text-[15px] text-ink hover:text-lime transition-colors"
              >
                {node.author.username}
              </a>
            ) : (
              <span class="font-headline font-black uppercase text-[15px] text-mute">{node.author.name}</span>
            )}
            <span class="font-mono text-[13px] text-mute">· {relativeTime(node.createdAt)}</span>
          </div>

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
                onCancel={() => setReplying(false)}
                onSubmit={async (body) => {
                  const ok = await onReply(node.id, body);
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

// ─── Composer ─────────────────────────────────────────────────────────────────

function Composer({
  placeholder,
  onSubmit,
  onCancel,
  avatar,
  compact = false,
  autoFocus = false,
}: {
  placeholder: string;
  onSubmit: (body: string) => Promise<boolean>;
  onCancel?: () => void;
  avatar?: ComponentChildren;
  compact?: boolean;
  autoFocus?: boolean;
}) {
  const [value, setValue] = useState('');
  const [pending, setPending] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

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

  async function submit() {
    const body = value.trim();
    if (!body || pending) return;
    setPending(true);
    const ok = await onSubmit(body);
    setPending(false);
    if (ok) setValue('');
  }

  function cancel() {
    setValue('');
    textareaRef.current?.blur();
    onCancel?.();
  }

  // Show Cancel on replies (to close them) and on the main composer once typing has started.
  const showCancel = !!onCancel || value.length > 0;

  return (
    <div class="flex gap-3">
      {avatar}
      <div class="flex-1 min-w-0">
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
          class="w-full bg-transparent border-0 border-b border-hairline rounded-none px-0 py-2 text-ink font-sans text-[16px] leading-relaxed resize-none placeholder:text-mute focus:outline-none focus:border-lime transition-colors"
        />
        <div class="flex justify-end items-center gap-2 mt-2">
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
