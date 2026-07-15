import { env } from 'cloudflare:workers';
import { LIVE_MATCH_PROTOCOL_VERSION, type LiveMatchEvent } from './liveMatchProtocol';
import type { CommentNode } from './commentService';

async function publish(event: Exclude<LiveMatchEvent, { type: 'match.snapshot' }>): Promise<void> {
  if (!env.LIVE_MATCH_COORDINATOR) return;
  try {
    await env.LIVE_MATCH_COORDINATOR.getByName(event.matchId).publish(event);
  } catch (error) {
    console.error(JSON.stringify({
      event: 'live_match_publish_failed',
      matchId: event.matchId,
      type: event.type,
      error: error instanceof Error ? error.message : String(error),
    }));
  }
}

export const publishCommentCreated = (matchId: string, comment: CommentNode) => publish({
  version: LIVE_MATCH_PROTOCOL_VERSION,
  type: 'comment.created',
  matchId,
  sentAt: new Date().toISOString(),
  payload: { comment },
});

export const publishCommentDeleted = (matchId: string, commentId: number) => publish({
  version: LIVE_MATCH_PROTOCOL_VERSION,
  type: 'comment.deleted',
  matchId,
  sentAt: new Date().toISOString(),
  payload: { commentId },
});

export const publishCommentVote = (matchId: string, commentId: number, upvotes: number) => publish({
  version: LIVE_MATCH_PROTOCOL_VERSION,
  type: 'comment.vote',
  matchId,
  sentAt: new Date().toISOString(),
  payload: { commentId, upvotes },
});
