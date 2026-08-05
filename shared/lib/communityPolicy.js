export const COMMUNITY_POST_TITLE_MAX = 100;
export const COMMUNITY_POST_BODY_MAX = 5000;
export const COMMUNITY_COMMENT_BODY_MAX = 1000;
export const COMMUNITY_POST_DAILY_LIMIT = 5;
export const COMMUNITY_COMMENT_DAILY_LIMIT = 50;
export const COMMUNITY_PAGE_SIZE = 30;
export const COMMUNITY_POPULAR_WINDOW_MS = 3 * 24 * 60 * 60 * 1000;

export function canViewCommunityActivity(privacy = {}, kind = "posts", isOwnProfile = false) {
  const key = kind === "comments" ? "communityComments" : "communityPosts";
  return isOwnProfile || privacy?.[key] !== false;
}

function policyError(code, statusCode = 400) {
  const error = new Error(code);
  error.statusCode = statusCode;
  return error;
}

function requiredText(value, minLength, maxLength, errorCode) {
  const text = String(value ?? "").trim();
  if (text.length < minLength || text.length > maxLength) throw policyError(errorCode);
  return text;
}

export function normalizeCommunityPostDraft(source = {}, adminLevel = 0) {
  const category = source.category === "notice" ? "notice" : "general";
  if (category === "notice" && adminLevel < 30) throw policyError("community_notice_admin_required", 403);
  return {
    category,
    title: requiredText(source.title, 2, COMMUNITY_POST_TITLE_MAX, "community_title_invalid"),
    body: requiredText(source.body, 2, COMMUNITY_POST_BODY_MAX, "community_body_invalid"),
    pinned: category === "notice" && adminLevel >= 30 && source.pinned === true,
  };
}

export function normalizeCommunityCommentBody(value) {
  return requiredText(value, 1, COMMUNITY_COMMENT_BODY_MAX, "community_comment_invalid");
}

export function getCommunityPopularityScore(post = {}) {
  return Math.max(0, Number(post.likeCount ?? post.like_count) || 0) * 3
    + Math.max(0, Number(post.commentCount ?? post.comment_count) || 0);
}

export function selectPopularCommunityPosts(posts = [], nowMs = Date.now()) {
  const cutoff = nowMs - COMMUNITY_POPULAR_WINDOW_MS;
  return posts
    .filter((post) => post.category === "general"
      && new Date(post.createdAt ?? post.created_at ?? 0).getTime() >= cutoff
      && getCommunityPopularityScore(post) > 0)
    .sort((a, b) => getCommunityPopularityScore(b) - getCommunityPopularityScore(a)
      || new Date(b.createdAt ?? b.created_at ?? 0).getTime() - new Date(a.createdAt ?? a.created_at ?? 0).getTime())
    .slice(0, 5);
}

export function assertCommunityReplyParent(parent = null, postId = "") {
  if (!parent || parent.post_id !== postId || parent.status !== "published" || parent.parent_id) {
    throw policyError("community_reply_parent_invalid");
  }
  return parent.id;
}
