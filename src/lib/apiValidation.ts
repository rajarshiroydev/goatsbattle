import { z } from 'zod';

export const slugSchema = z.string().trim().min(1).max(100).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
export const arenaSchema = z.enum(['football', 'cricket', 'tennis', 'f1']);
export const positiveIdSchema = z.number().int().positive().max(2_147_483_647);

export const voteBodySchema = z.object({
  battleId: slugSchema,
  choice: slugSchema,
}).strict();

export const rankVoteBodySchema = z.object({
  entityId: slugSchema,
  channel: z.enum(['profile', 'champion']),
}).strict();

export const commentBodySchema = z.object({
  battleId: slugSchema.optional(),
  matchId: slugSchema.optional(),
  parentId: positiveIdSchema.nullish(),
  momentId: positiveIdSchema.nullish(),
  body: z.string().max(4000),
  statTags: z.array(z.object({
    goatSlug: slugSchema,
    statLabel: z.string().trim().min(1).max(100),
  }).strict()).max(6).optional().default([]),
}).strict();

export const deleteCommentBodySchema = z.object({ commentId: positiveIdSchema }).strict();
export const commentVoteBodySchema = z.object({
  commentId: positiveIdSchema,
  remove: z.boolean().optional().default(false),
}).strict();

export type ParseBodyResult<T> =
  | { ok: true; data: T }
  | { ok: false; status: 400 | 413; error: string };

export async function parseJsonBody<T>(
  request: Request,
  schema: z.ZodType<T>,
  maxBytes = 16_384,
): Promise<ParseBodyResult<T>> {
  const declaredLength = Number(request.headers.get('content-length') ?? 0);
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
    return { ok: false, status: 413, error: 'Request body is too large' };
  }

  let raw: string;
  try {
    raw = await request.text();
  } catch {
    return { ok: false, status: 400, error: 'Could not read request body' };
  }
  if (new TextEncoder().encode(raw).byteLength > maxBytes) {
    return { ok: false, status: 413, error: 'Request body is too large' };
  }

  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return { ok: false, status: 400, error: 'Invalid JSON body' };
  }

  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    return { ok: false, status: 400, error: 'Request body failed validation' };
  }
  return { ok: true, data: parsed.data };
}
