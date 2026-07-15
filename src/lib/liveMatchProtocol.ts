import type { LiveClockState } from './liveMatchClock';
import type { Moment } from './matchMoments';
import type { CommentNode } from './commentService';

export const LIVE_MATCH_PROTOCOL_VERSION = 1 as const;

export interface LiveMatchSnapshot {
  matchId: string;
  status: string;
  homeScore: number | null;
  awayScore: number | null;
  homePenaltyScore: number | null;
  awayPenaltyScore: number | null;
  clock: LiveClockState | null;
  moments: Moment[];
  revision: number;
  freshness: {
    fetchedAt: string | null;
    lastSuccessAt: string | null;
    delayed: boolean;
  };
}

interface BaseEvent {
  version: typeof LIVE_MATCH_PROTOCOL_VERSION;
  matchId: string;
  sentAt: string;
}

export type LiveMatchEvent =
  | (BaseEvent & { type: 'match.snapshot'; payload: LiveMatchSnapshot })
  | (BaseEvent & { type: 'comment.created'; payload: { comment: CommentNode } })
  | (BaseEvent & { type: 'comment.deleted'; payload: { commentId: number } })
  | (BaseEvent & { type: 'comment.vote'; payload: { commentId: number; upvotes: number } })
  | (BaseEvent & {
      type: 'provider.health';
      payload: { status: 'healthy' | 'delayed'; failureCount: number; retryAt: string | null };
    });

export type PublishableLiveMatchEvent = Exclude<LiveMatchEvent, { type: 'match.snapshot' }>;
