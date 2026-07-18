/** Serialized fan allegiance displayed beside a comment author. */
export interface FanTag {
  slug: string;
  label: string;
  bg: string;
  fg: string;
}

/** Serialized timeline reference attached to a match comment. */
export interface CommentMomentRef {
  id: number;
  minute: number;
  extra: number | null;
  type: string;
  verificationStatus: 'active' | 'corrected';
}

/** Serialized canonical stat citation attached to a comment. */
export interface CommentStatTag {
  goatSlug: string;
  goatShortName: string;
  statLabel: string;
  value: string | number;
  unit?: string;
}

/** One flat serialized comment; clients assemble the tree from parentId. */
export interface CommentNode {
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
  moment: CommentMomentRef | null;
  statTags: CommentStatTag[];
}

export interface CommentListResponse {
  comments: CommentNode[];
}

export interface CommentCreateResponse {
  comment: CommentNode;
}
