import { and, eq, inArray, sql } from 'drizzle-orm';
import { db } from './db';
import { comments, commentVotes, commentStatTags, user, battles, matches, matchMoments } from './db/schema';
import { getFanTags, type FanTag } from './floor';
import { resolveStat, MAX_STAT_TAGS, type StatTag, type StatTagInput } from './statTags';

export { MAX_STAT_TAGS, type StatTagInput };

/** The timeline moment a comment is anchored to (null for un-anchored comments). */
export interface MomentRef {
  id: number;
  minute: number;
  extra: number | null;
  type: string;
  verificationStatus: 'provisional' | 'confirmed' | 'retracted' | 'superseded';
}

/**
 * What a comment is attached to — a 1v1 battle or a match (event). Exactly one
 * is set per comment (enforced by a CHECK in the schema). The service switches
 * its WHERE/insert on this so one comment stack serves both surfaces.
 */
export type CommentSubject = { battle: string } | { match: string };

const isMatch = (s: CommentSubject): s is { match: string } => 'match' in s;

/** WHERE clause selecting a subject's comments. */
const subjectWhere = (s: CommentSubject) =>
  isMatch(s) ? eq(comments.matchId, s.match) : eq(comments.battleId, s.battle);

/** One comment as sent to the client. The island builds the tree from parentId. */
export interface CommentNode {
  id: number;
  parentId: number | null;
  body: string; // "[deleted]" when the comment is soft-deleted
  upvotes: number;
  deleted: boolean;
  createdAt: string; // ISO
  /** Stable author id — the reliable owner check (usernames can be null/renamed). */
  authorId: string;
  author: { username: string | null; name: string; image: string | null };
  /** Whether the requesting viewer has upvoted this comment. */
  viewerUpvoted: boolean;
  /** The author's fan tag (goat they back), or null if they've cast no votes. */
  fanTag: FanTag | null;
  /** The match-timeline moment this comment is anchored to, if any. */
  moment: MomentRef | null;
  /** Definitive goat stats cited by this comment (value resolved from code). */
  statTags: StatTag[];
}

export const MAX_COMMENT_LENGTH = 4000;

/**
 * Flat list of a subject's comments (adjacency list — the island nests them by
 * `parentId`). Joins the author and computes `viewerUpvoted` for `viewerId`
 * (null for logged-out readers → always false). Soft-deleted bodies are blanked
 * server-side so the raw text never leaves the DB.
 */
export async function listComments(subject: CommentSubject, viewerId: string | null): Promise<CommentNode[]> {
  const viewerUpvoted = viewerId
    ? sql<boolean>`EXISTS (SELECT 1 FROM comment_votes cv WHERE cv.comment_id = ${comments.id} AND cv.user_id = ${viewerId})`
    : sql<boolean>`false`;

  const rows = await db
    .select({
      id: comments.id,
      parentId: comments.parentId,
      body: comments.body,
      upvotes: comments.upvotes,
      deleted: comments.deleted,
      createdAt: comments.createdAt,
      authorId: comments.userId,
      authorName: user.name,
      authorUsername: user.username,
      authorImage: user.image,
      viewerUpvoted,
      momentId: comments.momentId,
      momentMinute: matchMoments.minute,
      momentExtra: matchMoments.extra,
      momentType: matchMoments.type,
      momentVerificationStatus: matchMoments.verificationStatus,
    })
    .from(comments)
    .innerJoin(user, eq(user.id, comments.userId))
    .leftJoin(matchMoments, eq(matchMoments.id, comments.momentId))
    .where(subjectWhere(subject))
    .orderBy(comments.createdAt);

  const fanTags = await getFanTags(rows.map((r) => r.authorId));
  const statTagsByComment = await getStatTags(rows.map((r) => r.id));

  return rows.map((r) => ({
    id: r.id,
    parentId: r.parentId,
    body: r.deleted ? '[deleted]' : r.body,
    upvotes: r.upvotes,
    deleted: r.deleted,
    createdAt: new Date(r.createdAt).toISOString(),
    authorId: r.authorId,
    author: { username: r.authorUsername, name: r.authorName, image: r.authorImage },
    viewerUpvoted: !!r.viewerUpvoted,
    fanTag: fanTags.get(r.authorId) ?? null,
    moment:
      r.momentId !== null && r.momentMinute !== null
        ? {
            id: r.momentId,
            minute: r.momentMinute,
            extra: r.momentExtra,
            type: r.momentType!,
            verificationStatus: r.momentVerificationStatus as MomentRef['verificationStatus'],
          }
        : null,
    statTags: statTagsByComment.get(r.id) ?? [],
  }));
}

/**
 * Batch-load stat tags for a set of comments and resolve each to its live value
 * from code (dropping any whose goat/stat no longer exists). One query for the
 * whole page, grouped by comment id.
 */
async function getStatTags(commentIds: number[]): Promise<Map<number, StatTag[]>> {
  const out = new Map<number, StatTag[]>();
  if (commentIds.length === 0) return out;
  const rows = await db
    .select({ commentId: commentStatTags.commentId, goatSlug: commentStatTags.goatSlug, statLabel: commentStatTags.statLabel })
    .from(commentStatTags)
    .where(inArray(commentStatTags.commentId, commentIds));
  for (const r of rows) {
    const resolved = resolveStat(r.goatSlug, r.statLabel);
    if (!resolved) continue;
    const list = out.get(r.commentId) ?? [];
    list.push(resolved);
    out.set(r.commentId, list);
  }
  return out;
}

export type PostCommentResult =
  | { status: 'ok'; comment: CommentNode }
  | { status: 'invalid'; error: string }
  | { status: 'not_found' };

/**
 * Create a comment (or reply). Validates the body length, that any `parentId`
 * belongs to the same subject, and that any `momentId` belongs to this match.
 * Returns the created node shaped like the list.
 */
export async function postComment(
  subject: CommentSubject,
  userId: string,
  parentId: number | null,
  rawBody: string,
  momentId: number | null = null,
  statTagInputs: StatTagInput[] = [],
): Promise<PostCommentResult> {
  const body = rawBody.trim();
  if (body.length === 0) return { status: 'invalid', error: 'Comment cannot be empty' };
  if (body.length > MAX_COMMENT_LENGTH) {
    return { status: 'invalid', error: `Comment is too long (max ${MAX_COMMENT_LENGTH})` };
  }

  // The subject (battle or match) must exist.
  const subjectId = isMatch(subject) ? subject.match : subject.battle;
  const exists = isMatch(subject)
    ? await db.select({ id: matches.id }).from(matches).where(eq(matches.id, subjectId)).limit(1)
    : await db.select({ id: battles.id }).from(battles).where(eq(battles.id, subjectId)).limit(1);
  if (exists.length === 0) return { status: 'not_found' };

  if (parentId !== null) {
    const [parent] = await db
      .select({ battleId: comments.battleId, matchId: comments.matchId })
      .from(comments)
      .where(eq(comments.id, parentId))
      .limit(1);
    const parentSubjectId = parent ? (isMatch(subject) ? parent.matchId : parent.battleId) : null;
    if (!parent || parentSubjectId !== subjectId) {
      return { status: 'invalid', error: 'Invalid parent comment' };
    }
  }

  // A moment anchor is only valid on a match comment, and must belong to it.
  let moment: MomentRef | null = null;
  if (momentId !== null) {
    if (!isMatch(subject)) {
      return { status: 'invalid', error: 'Only match comments can tag a moment' };
    }
    const [m] = await db
      .select({
        id: matchMoments.id,
        matchId: matchMoments.matchId,
        minute: matchMoments.minute,
        extra: matchMoments.extra,
        type: matchMoments.type,
        verificationStatus: matchMoments.verificationStatus,
      })
      .from(matchMoments)
      .where(and(
        eq(matchMoments.id, momentId),
        inArray(matchMoments.verificationStatus, ['provisional', 'confirmed']),
      ))
      .limit(1);
    if (!m || m.matchId !== subject.match) {
      return { status: 'invalid', error: 'Invalid moment' };
    }
    moment = {
      id: m.id,
      minute: m.minute,
      extra: m.extra,
      type: m.type,
      verificationStatus: m.verificationStatus as MomentRef['verificationStatus'],
    };
  }

  // Resolve + dedupe the cited stats, dropping unknown goat/label pairs and
  // capping the count. Values come from code so they can't be spoofed.
  const seen = new Set<string>();
  const statTags: StatTag[] = [];
  for (const t of statTagInputs.slice(0, MAX_STAT_TAGS)) {
    const key = `${t.goatSlug}|${t.statLabel}`;
    if (seen.has(key)) continue;
    const resolved = resolveStat(t.goatSlug, t.statLabel);
    if (!resolved) continue;
    seen.add(key);
    statTags.push(resolved);
  }

  const [inserted] = await db
    .insert(comments)
    .values({
      battleId: isMatch(subject) ? null : subject.battle,
      matchId: isMatch(subject) ? subject.match : null,
      momentId,
      userId,
      parentId,
      body,
    })
    .returning({ id: comments.id, createdAt: comments.createdAt });

  if (statTags.length > 0) {
    await db
      .insert(commentStatTags)
      .values(statTags.map((s) => ({ commentId: inserted.id, goatSlug: s.goatSlug, statLabel: s.statLabel })))
      .onConflictDoNothing();
  }

  const [author] = await db
    .select({ name: user.name, username: user.username, image: user.image })
    .from(user)
    .where(eq(user.id, userId))
    .limit(1);

  const fanTags = await getFanTags([userId]);

  return {
    status: 'ok',
    comment: {
      id: inserted.id,
      parentId,
      body,
      upvotes: 0,
      deleted: false,
      createdAt: new Date(inserted.createdAt).toISOString(),
      authorId: userId,
      author: { username: author?.username ?? null, name: author?.name ?? 'Unknown', image: author?.image ?? null },
      viewerUpvoted: false,
      fanTag: fanTags.get(userId) ?? null,
      moment,
      statTags,
    },
  };
}

export type DeleteResult = { status: 'ok' } | { status: 'not_found' } | { status: 'forbidden' };

/** Soft-delete a comment (author only). Keeps the row so replies stay threaded. */
export async function deleteComment(commentId: number, userId: string): Promise<DeleteResult> {
  const [row] = await db
    .select({ userId: comments.userId })
    .from(comments)
    .where(eq(comments.id, commentId))
    .limit(1);
  if (!row) return { status: 'not_found' };
  if (row.userId !== userId) return { status: 'forbidden' };

  await db
    .update(comments)
    .set({ deleted: true, body: '', updatedAt: new Date() })
    .where(eq(comments.id, commentId));
  return { status: 'ok' };
}

export interface UpvoteResult {
  status: 'ok' | 'not_found';
  upvotes: number;
  viewerUpvoted: boolean;
}

/**
 * Toggle an upvote for (comment, user). The composite PK makes the add
 * idempotent (`onConflictDoNothing`); the count only moves when a row is
 * actually inserted/deleted, so double-taps can't inflate it.
 */
export async function toggleCommentUpvote(
  commentId: number,
  userId: string,
  remove: boolean,
): Promise<UpvoteResult> {
  // A soft-deleted comment is treated as gone — no vote mutations allowed.
  const [exists] = await db
    .select({ id: comments.id })
    .from(comments)
    .where(and(eq(comments.id, commentId), eq(comments.deleted, false)))
    .limit(1);
  if (!exists) return { status: 'not_found', upvotes: 0, viewerUpvoted: false };

  if (remove) {
    const deleted = await db
      .delete(commentVotes)
      .where(and(eq(commentVotes.commentId, commentId), eq(commentVotes.userId, userId)))
      .returning({ commentId: commentVotes.commentId });
    if (deleted.length > 0) {
      await db
        .update(comments)
        .set({ upvotes: sql`GREATEST(${comments.upvotes} - 1, 0)` })
        .where(eq(comments.id, commentId));
    }
  } else {
    const added = await db
      .insert(commentVotes)
      .values({ commentId, userId })
      .onConflictDoNothing()
      .returning({ commentId: commentVotes.commentId });
    if (added.length > 0) {
      await db
        .update(comments)
        .set({ upvotes: sql`${comments.upvotes} + 1` })
        .where(eq(comments.id, commentId));
    }
  }

  const [fresh] = await db
    .select({ upvotes: comments.upvotes })
    .from(comments)
    .where(eq(comments.id, commentId))
    .limit(1);

  return { status: 'ok', upvotes: fresh?.upvotes ?? 0, viewerUpvoted: !remove };
}
