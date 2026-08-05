import { allowRequestMethod, getAdminLevel, getAuthenticatedContext, readJsonBody, sendJson } from "../_supabaseAdmin.js";
import { fromRemoteProfile } from "../../../shared/lib/profileMappers.js";
import { PROFILE_CARD_COLUMNS, TEAM_COLUMNS, TEAM_MEMBER_COLUMNS } from "../../../shared/lib/repositoryColumns.js";
import { fromRemoteTeam } from "../../../shared/lib/teamMappers.js";
import {
  COMMUNITY_COMMENT_DAILY_LIMIT,
  COMMUNITY_PAGE_SIZE,
  COMMUNITY_POPULAR_WINDOW_MS,
  COMMUNITY_POST_DAILY_LIMIT,
  assertCommunityReplyParent,
  canViewCommunityActivity,
  normalizeCommunityCommentBody,
  normalizeCommunityPostDraft,
  selectPopularCommunityPosts,
} from "../../../shared/lib/communityPolicy.js";

const POST_LIST_COLUMNS = "id,author_id,category,title,status,pinned,like_count,comment_count,created_at,updated_at";
const POST_DETAIL_COLUMNS = `${POST_LIST_COLUMNS},body`;
const COMMENT_COLUMNS = "id,post_id,author_id,parent_id,body,status,created_at,updated_at";
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function requestError(code, statusCode = 400) {
  const error = new Error(code);
  error.statusCode = statusCode;
  return error;
}

function requiredId(value, code) {
  const id = String(value ?? "").trim();
  if (!UUID_PATTERN.test(id)) throw requestError(code);
  return id;
}

function requiredProfileId(value) {
  const id = String(value ?? "").trim();
  if (!id || id.length > 128) throw requestError("community_profile_id_invalid");
  return id;
}

function toPost(row = {}, profileById = new Map(), likedPostIds = new Set()) {
  return {
    id: row.id,
    authorId: row.author_id,
    author: profileById.get(row.author_id) ?? null,
    category: row.category,
    title: row.title,
    body: row.body,
    pinned: row.pinned === true,
    likeCount: Number(row.like_count ?? 0),
    commentCount: Number(row.comment_count ?? 0),
    liked: likedPostIds.has(row.id),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function toComment(row = {}, profileById = new Map()) {
  return {
    id: row.id,
    postId: row.post_id,
    authorId: row.author_id,
    author: profileById.get(row.author_id) ?? null,
    parentId: row.parent_id,
    body: row.body,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

async function loadProfileMap(context, ids = []) {
  const profileIds = [...new Set(ids.filter(Boolean))];
  if (!profileIds.length) return new Map();
  const { data, error } = await context.supabase.from("profiles").select(`${PROFILE_CARD_COLUMNS},app_settings`).in("id", profileIds);
  if (error) throw error;
  const rows = data ?? [];
  const representativeTeamIdByProfileId = new Map(rows.flatMap((row) => {
    const teamId = row.id === context.profileId || row.app_settings?.privacy?.teamHistory !== false
      ? String(row.app_settings?.representativeTeamId ?? "").trim()
      : "";
    return teamId ? [[row.id, teamId]] : [];
  }));
  const teamIds = [...new Set(representativeTeamIdByProfileId.values())];
  const [teamResult, memberResult] = teamIds.length ? await Promise.all([
    context.supabase.from("teams").select(TEAM_COLUMNS).in("id", teamIds).is("deleted_at", null),
    context.supabase.from("team_members").select(TEAM_MEMBER_COLUMNS).in("team_id", teamIds).in("user_id", profileIds),
  ]) : [{ data: [] }, { data: [] }];
  if (teamResult.error) throw teamResult.error;
  if (memberResult.error) throw memberResult.error;
  const teamById = new Map((teamResult.data ?? []).map((row) => [row.id, row]));
  const memberByProfileAndTeam = new Map((memberResult.data ?? []).map((row) => [`${row.user_id}\0${row.team_id}`, row]));
  return new Map(rows.map((row) => {
    const representativeTeamId = representativeTeamIdByProfileId.get(row.id) ?? "";
    const member = memberByProfileAndTeam.get(`${row.id}\0${representativeTeamId}`);
    const teamRow = member ? teamById.get(representativeTeamId) : null;
    const profile = fromRemoteProfile({ ...row, app_settings: representativeTeamId ? { representativeTeamId } : {} });
    return [row.id, {
      ...profile,
      ...(teamRow ? { representativeTeam: fromRemoteTeam(teamRow, [member]) } : {}),
    }];
  }));
}

async function loadLikedPostIds(context, postIds = []) {
  if (!postIds.length) return new Set();
  const { data, error } = await context.supabase
    .from("community_post_likes")
    .select("post_id")
    .eq("user_id", context.profileId)
    .in("post_id", postIds);
  if (error) throw error;
  return new Set((data ?? []).map((row) => row.post_id));
}

async function readPublishedPost(context, postId, columns = POST_DETAIL_COLUMNS) {
  const { data, error } = await context.supabase
    .from("community_posts")
    .select(columns)
    .eq("id", postId)
    .eq("status", "published")
    .maybeSingle();
  if (error) throw error;
  if (!data) throw requestError("community_post_not_found", 404);
  return data;
}

async function enforceDailyLimit(context, table, limit, errorCode) {
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const { count, error } = await context.supabase
    .from(table)
    .select("id", { count: "exact", head: true })
    .eq("author_id", context.profileId)
    .gte("created_at", since);
  if (error) throw error;
  if (Number(count ?? 0) >= limit) throw requestError(errorCode, 429);
}

function getBlockedUserIds(context) {
  return new Set((context.profile?.app_settings?.blockedUserIds ?? []).map((id) => String(id)));
}

async function listPosts(context, body, adminLevel) {
  const limit = Math.max(10, Math.min(40, Math.floor(Number(body.limit) || COMMUNITY_PAGE_SIZE)));
  const offset = Math.max(0, Math.floor(Number(body.offset) || 0));
  const category = body.category === "notice" || body.category === "general" ? body.category : "all";
  let query = context.supabase
    .from("community_posts")
    .select(POST_LIST_COLUMNS, { count: "exact" })
    .eq("status", "published")
    .order("pinned", { ascending: false })
    .order("created_at", { ascending: false })
    .range(offset, offset + limit - 1);
  if (category !== "all") query = query.eq("category", category);

  const popularCutoff = new Date(Date.now() - COMMUNITY_POPULAR_WINDOW_MS).toISOString();
  const [feedResult, popularResult] = await Promise.all([
    query,
    context.supabase
      .from("community_posts")
      .select(POST_LIST_COLUMNS)
      .eq("status", "published")
      .eq("category", "general")
      .gte("created_at", popularCutoff)
      .order("created_at", { ascending: false })
      .limit(1000),
  ]);
  if (feedResult.error) throw feedResult.error;
  if (popularResult.error) throw popularResult.error;

  const blockedIds = getBlockedUserIds(context);
  const visibleFeed = (feedResult.data ?? []).filter((row) => row.category === "notice" || !blockedIds.has(row.author_id));
  const visiblePopular = (popularResult.data ?? []).filter((row) => !blockedIds.has(row.author_id));
  const selectedPopularRows = selectPopularCommunityPosts(visiblePopular);
  const allRows = [...visibleFeed, ...selectedPopularRows];
  const postIds = [...new Set(allRows.map((row) => row.id))];
  const [profileById, likedPostIds] = await Promise.all([
    loadProfileMap(context, allRows.map((row) => row.author_id)),
    loadLikedPostIds(context, postIds),
  ]);
  const posts = visibleFeed.map((row) => toPost(row, profileById, likedPostIds));
  const popularPosts = selectedPopularRows.map((row) => toPost(row, profileById, likedPostIds));
  return {
    ok: true,
    posts,
    popularPosts,
    canModerate: adminLevel >= 30,
    page: {
      offset,
      limit,
      total: Number(feedResult.count ?? posts.length),
      hasMore: offset + limit < Number(feedResult.count ?? 0),
      nextOffset: offset + limit,
    },
  };
}

async function loadProfileActivity(context, body) {
  const profileId = requiredProfileId(body.profileId);
  const kind = body.kind === "comments" ? "comments" : "posts";
  const offset = Math.max(0, Math.floor(Number(body.offset) || 0));
  let target = context.profile;
  if (profileId !== context.profileId) {
    const targetResult = await context.supabase.from("profiles").select("id,app_settings").eq("id", profileId).maybeSingle();
    if (targetResult.error) throw targetResult.error;
    target = targetResult.data;
  }
  if (!target) throw requestError("community_profile_not_found", 404);
  const visible = canViewCommunityActivity(target.app_settings?.privacy, kind, profileId === context.profileId)
    && !getBlockedUserIds(context).has(profileId);
  if (!visible) return { ok: true, hidden: true, items: [], page: { offset, limit: COMMUNITY_PAGE_SIZE, total: 0, hasMore: false } };

  const query = kind === "comments"
    ? context.supabase
      .from("community_comments")
      .select(`${COMMENT_COLUMNS},post:community_posts!inner(${POST_LIST_COLUMNS})`, { count: "exact" })
      .eq("author_id", profileId)
      .eq("status", "published")
      .eq("post.status", "published")
    : context.supabase
      .from("community_posts")
      .select(POST_LIST_COLUMNS, { count: "exact" })
      .eq("author_id", profileId)
      .eq("status", "published");
  const { data, count, error } = await query
    .order("created_at", { ascending: false })
    .range(offset, offset + COMMUNITY_PAGE_SIZE - 1);
  if (error) throw error;
  const items = kind === "comments"
    ? (data ?? []).flatMap((row) => {
      const post = Array.isArray(row.post) ? row.post[0] : row.post;
      return post ? [{ ...toComment(row), post: toPost(post) }] : [];
    })
    : (data ?? []).map((row) => toPost(row));
  return {
    ok: true,
    items,
    page: {
      offset,
      limit: COMMUNITY_PAGE_SIZE,
      total: Number(count ?? items.length),
      hasMore: offset + COMMUNITY_PAGE_SIZE < Number(count ?? 0),
    },
  };
}

async function loadPostDetail(context, postId, adminLevel) {
  const row = await readPublishedPost(context, postId);
  const blockedIds = getBlockedUserIds(context);
  if (row.category !== "notice" && blockedIds.has(row.author_id)) throw requestError("community_post_not_found", 404);
  const [commentsResult, likedPostIds] = await Promise.all([
    context.supabase
      .from("community_comments")
      .select(COMMENT_COLUMNS)
      .eq("post_id", postId)
      .eq("status", "published")
      .order("created_at", { ascending: true }),
    loadLikedPostIds(context, [postId]),
  ]);
  if (commentsResult.error) throw commentsResult.error;
  const visibleComments = (commentsResult.data ?? []).filter((comment) => !blockedIds.has(comment.author_id));
  const visibleRootIds = new Set(visibleComments.filter((comment) => !comment.parent_id).map((comment) => comment.id));
  const threadedComments = visibleComments.filter((comment) => !comment.parent_id || visibleRootIds.has(comment.parent_id));
  const profileById = await loadProfileMap(context, [row.author_id, ...threadedComments.map((comment) => comment.author_id)]);
  return {
    ok: true,
    post: toPost(row, profileById, likedPostIds),
    comments: threadedComments.map((comment) => toComment(comment, profileById)),
    canModerate: adminLevel >= 30,
  };
}

async function createPost(context, body, adminLevel) {
  if (adminLevel < 30) await enforceDailyLimit(context, "community_posts", COMMUNITY_POST_DAILY_LIMIT, "community_post_daily_limit");
  const draft = normalizeCommunityPostDraft(body.post, adminLevel);
  const { data, error } = await context.supabase
    .from("community_posts")
    .insert({ author_id: context.profileId, ...draft })
    .select("id")
    .single();
  if (error) throw error;
  return loadPostDetail(context, data.id, adminLevel);
}

async function updatePost(context, body, adminLevel) {
  const postId = requiredId(body.postId, "community_post_id_invalid");
  const current = await readPublishedPost(context, postId, "id,author_id");
  if (current.author_id !== context.profileId) throw requestError("community_post_edit_forbidden", 403);
  const draft = normalizeCommunityPostDraft(body.post, adminLevel);
  const { error } = await context.supabase
    .from("community_posts")
    .update({ ...draft, updated_at: new Date().toISOString() })
    .eq("id", postId)
    .eq("status", "published");
  if (error) throw error;
  return loadPostDetail(context, postId, adminLevel);
}

async function deletePost(context, body, adminLevel) {
  const postId = requiredId(body.postId, "community_post_id_invalid");
  const current = await readPublishedPost(context, postId, "id,author_id");
  if (current.author_id !== context.profileId && adminLevel < 30) throw requestError("community_post_delete_forbidden", 403);
  const now = new Date().toISOString();
  const { error } = await context.supabase
    .from("community_posts")
    .update({ status: "deleted", pinned: false, deleted_by: context.profileId, deleted_at: now, updated_at: now })
    .eq("id", postId)
    .eq("status", "published");
  if (error) throw error;
  return { ok: true, postId };
}

async function togglePostLike(context, body) {
  const postId = requiredId(body.postId, "community_post_id_invalid");
  await readPublishedPost(context, postId, "id");
  const { data: existing, error: readError } = await context.supabase
    .from("community_post_likes")
    .select("post_id")
    .eq("post_id", postId)
    .eq("user_id", context.profileId)
    .maybeSingle();
  if (readError) throw readError;
  const mutation = existing
    ? context.supabase.from("community_post_likes").delete().eq("post_id", postId).eq("user_id", context.profileId)
    : context.supabase.from("community_post_likes").insert({ post_id: postId, user_id: context.profileId });
  const { error } = await mutation;
  if (error && error.code !== "23505") throw error;
  const post = await readPublishedPost(context, postId, "id,like_count");
  return { ok: true, postId, liked: !existing, likeCount: Number(post.like_count ?? 0) };
}

async function createComment(context, body, adminLevel) {
  const postId = requiredId(body.postId, "community_post_id_invalid");
  await readPublishedPost(context, postId, "id");
  if (adminLevel < 30) await enforceDailyLimit(context, "community_comments", COMMUNITY_COMMENT_DAILY_LIMIT, "community_comment_daily_limit");
  const parentId = body.parentId ? requiredId(body.parentId, "community_parent_id_invalid") : null;
  if (parentId) {
    const { data: parent, error } = await context.supabase.from("community_comments").select("id,post_id,parent_id,status").eq("id", parentId).maybeSingle();
    if (error) throw error;
    assertCommunityReplyParent(parent, postId);
  }
  const commentBody = normalizeCommunityCommentBody(body.body);
  const { error } = await context.supabase
    .from("community_comments")
    .insert({ post_id: postId, author_id: context.profileId, parent_id: parentId, body: commentBody });
  if (error) throw error;
  return loadPostDetail(context, postId, adminLevel);
}

async function deleteComment(context, body, adminLevel) {
  const commentId = requiredId(body.commentId, "community_comment_id_invalid");
  const { data: comment, error: readError } = await context.supabase
    .from("community_comments")
    .select("id,post_id,author_id,parent_id,status")
    .eq("id", commentId)
    .eq("status", "published")
    .maybeSingle();
  if (readError) throw readError;
  if (!comment) throw requestError("community_comment_not_found", 404);
  if (comment.author_id !== context.profileId && adminLevel < 30) throw requestError("community_comment_delete_forbidden", 403);
  const now = new Date().toISOString();
  let update = context.supabase
    .from("community_comments")
    .update({ status: "deleted", deleted_by: context.profileId, deleted_at: now, updated_at: now })
    .eq("status", "published");
  update = comment.parent_id
    ? update.eq("id", commentId)
    : update.or(`id.eq.${commentId},parent_id.eq.${commentId}`);
  const { error } = await update;
  if (error) throw error;
  return loadPostDetail(context, comment.post_id, adminLevel);
}

export default async function handler(request, response) {
  if (!allowRequestMethod(request, response)) return;
  try {
    const body = await readJsonBody(request);
    const operation = String(body.operation ?? "list");
    const context = await getAuthenticatedContext(request, { profileSelect: "id,auth_user_id,app_settings" });
    const adminLevel = await getAdminLevel(context);
    let result;
    if (operation === "list") result = await listPosts(context, body, adminLevel);
    else if (operation === "profileActivity") result = await loadProfileActivity(context, body);
    else if (operation === "detail") result = await loadPostDetail(context, requiredId(body.postId, "community_post_id_invalid"), adminLevel);
    else if (operation === "createPost") result = await createPost(context, body, adminLevel);
    else if (operation === "updatePost") result = await updatePost(context, body, adminLevel);
    else if (operation === "deletePost") result = await deletePost(context, body, adminLevel);
    else if (operation === "toggleLike") result = await togglePostLike(context, body);
    else if (operation === "createComment") result = await createComment(context, body, adminLevel);
    else if (operation === "deleteComment") result = await deleteComment(context, body, adminLevel);
    else throw requestError("community_operation_invalid");
    sendJson(response, 200, result);
  } catch (error) {
    console.error("Community operation failed.", error);
    sendJson(response, error.statusCode || 500, { error: error.message || "community_operation_failed" });
  }
}
