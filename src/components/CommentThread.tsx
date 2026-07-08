import { useEffect, useMemo, useState } from 'preact/hooks';
import { useSession } from '../lib/useSession';
import { openAuthModal } from '../lib/authModal';
import { relativeTime } from '../lib/format';

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
}

interface Props {
  battleId: string;
}

const MAX_DEPTH = 6;

export default function CommentThread({ battleId }: Props) {
  const { user } = useSession();
  const [comments, setComments] = useState<CommentNode[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    fetch(`/api/comments?battle=${encodeURIComponent(battleId)}`)
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((data: { comments: CommentNode[] }) => active && setComments(data.comments))
      .catch(() => active && setError('Could not load comments'))
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
    };
  }, [battleId]);

  // Adjacency list → nested tree, built once per comments change.
  const tree = useMemo(() => buildTree(comments), [comments]);

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
        body: JSON.stringify({ battleId, parentId, body }),
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
    const remove = node.viewerUpvoted;
    // Optimistic flip.
    updateComment(node.id, {
      viewerUpvoted: !remove,
      upvotes: node.upvotes + (remove ? -1 : 1),
    });
    try {
      const res = await fetch('/api/comment-vote', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ commentId: node.id, remove }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error();
      updateComment(node.id, { upvotes: data.upvotes, viewerUpvoted: data.viewerUpvoted });
    } catch {
      // Roll back.
      updateComment(node.id, { viewerUpvoted: remove, upvotes: node.upvotes });
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
      {/* Composer */}
      {user ? (
        <Composer placeholder="Add to the debate…" onSubmit={(body) => post(null, body)} />
      ) : (
        <button
          onClick={() => openAuthModal({ reason: 'Log in to join the discussion' })}
          class="w-full bg-canvas-soft-2 border border-hairline rounded-md px-4 py-4 text-left font-sans text-body hover:border-hairline-strong transition-colors"
        >
          <span class="text-lime font-semibold">Log in</span> to join the discussion
        </button>
      )}

      {error && <p class="font-mono text-[13px] text-red mt-3">{error}</p>}

      {/* Thread */}
      <div class="mt-6">
        {loading ? (
          <div class="space-y-3">
            {[0, 1, 2].map(() => (
              <div class="h-16 bg-canvas-soft border border-hairline rounded-md animate-pulse" />
            ))}
          </div>
        ) : count === 0 ? (
          <p class="font-mono text-[13px] uppercase tracking-widest text-mute py-6 text-center">
            Be the first to weigh in
          </p>
        ) : (
          <ul class="space-y-3">
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
          </ul>
        )}
      </div>
    </div>
  );
}

// ─── Tree node ────────────────────────────────────────────────────────────────

interface TreeNode extends CommentNode {
  children: TreeNode[];
}

function buildTree(flat: CommentNode[]): TreeNode[] {
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
  // Top-level: highest upvotes first, then newest. Replies: chronological.
  roots.sort((a, b) => b.upvotes - a.upvotes || +new Date(b.createdAt) - +new Date(a.createdAt));
  const sortReplies = (n: TreeNode) => {
    n.children.sort((a, b) => +new Date(a.createdAt) - +new Date(b.createdAt));
    n.children.forEach(sortReplies);
  };
  roots.forEach(sortReplies);
  return roots;
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

  return (
    <li>
      <div class="bg-canvas-soft border border-hairline rounded-md px-4 py-3">
        {/* Meta */}
        <div class="flex items-center gap-2 mb-1.5">
          {node.author.username ? (
            <a
              href={`/users/${node.author.username}`}
              class="font-headline font-black uppercase text-sm text-ink hover:text-lime transition-colors"
            >
              {node.author.username}
            </a>
          ) : (
            <span class="font-headline font-black uppercase text-sm text-mute">{node.author.name}</span>
          )}
          <span class="font-mono text-[12px] text-mute">· {relativeTime(node.createdAt)}</span>
        </div>

        {/* Body */}
        <p class={`font-sans text-[15px] leading-relaxed whitespace-pre-wrap break-words ${node.deleted ? 'text-mute italic' : 'text-body'}`}>
          {node.body}
        </p>

        {/* Actions */}
        <div class="flex items-center gap-4 mt-2">
          <button
            onClick={() => onUpvote(node)}
            disabled={node.deleted}
            class={`flex items-center gap-1 font-mono text-[12px] transition-colors disabled:opacity-40 ${
              node.viewerUpvoted ? 'text-lime' : 'text-mute hover:text-ink'
            }`}
          >
            ▲ {node.upvotes}
          </button>
          {!node.deleted && depth < MAX_DEPTH && (
            <button
              onClick={() => setReplying((r) => !r)}
              class="font-mono text-[12px] text-mute hover:text-ink transition-colors"
            >
              Reply
            </button>
          )}
          {isAuthor && !node.deleted && (
            <button
              onClick={() => onDelete(node)}
              class="font-mono text-[12px] text-mute hover:text-red transition-colors"
            >
              Delete
            </button>
          )}
          {replyCount > 0 && (
            <button
              onClick={() => setCollapsed((c) => !c)}
              class="font-mono text-[12px] text-mute hover:text-ink transition-colors ml-auto"
            >
              {collapsed ? `[+] ${replyCount} ${replyCount === 1 ? 'reply' : 'replies'}` : '[–] collapse'}
            </button>
          )}
        </div>

        {replying && (
          <div class="mt-3">
            <Composer
              placeholder={`Reply to ${node.author.username ?? node.author.name}…`}
              compact
              autoFocus
              onSubmit={async (body) => {
                const ok = await onReply(node.id, body);
                if (ok) setReplying(false);
                return ok;
              }}
            />
          </div>
        )}
      </div>

      {/* Children */}
      {!collapsed && node.children.length > 0 && (
        <ul class="mt-3 space-y-3 border-l border-hairline pl-4 ml-2">
          {node.children.map((child) => (
            <CommentItem
              key={child.id}
              node={child}
              depth={depth + 1}
              viewerId={viewerId}
              onUpvote={onUpvote}
              onReply={onReply}
              onDelete={onDelete}
            />
          ))}
        </ul>
      )}
    </li>
  );
}

function countDescendants(node: TreeNode): number {
  return node.children.reduce((sum, c) => sum + 1 + countDescendants(c), 0);
}

// ─── Composer ─────────────────────────────────────────────────────────────────

function Composer({
  placeholder,
  onSubmit,
  compact = false,
  autoFocus = false,
}: {
  placeholder: string;
  onSubmit: (body: string) => Promise<boolean>;
  compact?: boolean;
  autoFocus?: boolean;
}) {
  const [value, setValue] = useState('');
  const [pending, setPending] = useState(false);

  async function submit() {
    const body = value.trim();
    if (!body || pending) return;
    setPending(true);
    const ok = await onSubmit(body);
    setPending(false);
    if (ok) setValue('');
  }

  return (
    <div>
      <textarea
        value={value}
        placeholder={placeholder}
        rows={compact ? 2 : 3}
        autoFocus={autoFocus}
        onInput={(e) => setValue((e.target as HTMLTextAreaElement).value)}
        onKeyDown={(e) => {
          if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') submit();
        }}
        class="w-full bg-canvas-soft-2 border border-hairline rounded-md px-3 py-2.5 text-ink font-sans text-[15px] resize-y focus:outline-none focus:border-lime"
      />
      <div class="flex justify-end mt-2">
        <button
          onClick={submit}
          disabled={pending || value.trim().length === 0}
          class="font-headline font-black uppercase tracking-wider text-sm bg-lime text-canvas px-5 h-9 rounded-sm hover:bg-lime-dark transition-colors disabled:opacity-40"
        >
          {pending ? '…' : compact ? 'Reply' : 'Post'}
        </button>
      </div>
    </div>
  );
}
