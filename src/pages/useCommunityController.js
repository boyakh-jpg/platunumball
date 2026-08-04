import { useCallback, useEffect, useMemo, useState } from "react";
import { isSupabaseConfigured } from "../lib/supabase.js";
import {
  normalizeCommunityCommentBody,
  normalizeCommunityPostDraft,
  selectPopularCommunityPosts,
} from "../../shared/lib/communityPolicy.js";

function hoursAgo(hours) {
  return new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();
}

function makeLocalId(prefix) {
  return `${prefix}_${globalThis.crypto?.randomUUID?.() ?? `${Date.now()}_${Math.random().toString(36).slice(2)}`}`;
}

function makeDemoBoard(currentUser, users = []) {
  const secondUser = users.find((user) => user.id !== currentUser?.id) ?? currentUser;
  const posts = [
    { id: "community_demo_notice", authorId: secondUser?.id, author: secondUser, category: "notice", title: "커뮤니티 이용 안내", body: "경기 모집은 매칭 메뉴를 이용하고, 이곳에는 농구 이야기와 구장 정보를 남겨 주세요.", pinned: true, likeCount: 4, commentCount: 0, liked: false, createdAt: hoursAgo(8), updatedAt: hoursAgo(8) },
    { id: "community_demo_1", authorId: secondUser?.id, author: secondUser, category: "general", title: "오늘 저녁 야외 코트 상태 어떤가요?", body: "비가 그친 뒤 바닥이 말랐는지 궁금합니다. 다녀온 분 있으면 알려 주세요.", pinned: false, likeCount: 8, commentCount: 2, liked: false, createdAt: hoursAgo(3), updatedAt: hoursAgo(3) },
    { id: "community_demo_2", authorId: currentUser?.id, author: currentUser, category: "general", title: "처음 3대3 할 때 지키면 좋은 것", body: "공격 전 체크볼과 파울 콜을 먼저 합의하면 경기가 훨씬 매끄럽습니다.", pinned: false, likeCount: 5, commentCount: 1, liked: true, createdAt: hoursAgo(10), updatedAt: hoursAgo(10) },
    { id: "community_demo_3", authorId: secondUser?.id, author: secondUser, category: "general", title: "주말 오전 슛 연습", body: "혼자 연습하기 좋은 시간대와 구장을 공유해 봐요.", pinned: false, likeCount: 3, commentCount: 0, liked: false, createdAt: hoursAgo(28), updatedAt: hoursAgo(28) },
  ];
  const comments = [
    { id: "community_demo_comment_1", postId: "community_demo_1", authorId: currentUser?.id, author: currentUser, parentId: null, body: "오후에는 거의 말랐습니다.", createdAt: hoursAgo(2), updatedAt: hoursAgo(2) },
    { id: "community_demo_comment_2", postId: "community_demo_1", authorId: secondUser?.id, author: secondUser, parentId: "community_demo_comment_1", body: "확인 감사합니다.", createdAt: hoursAgo(1), updatedAt: hoursAgo(1) },
    { id: "community_demo_comment_3", postId: "community_demo_2", authorId: secondUser?.id, author: secondUser, parentId: null, body: "파울 기준도 시작 전에 맞추면 좋더라고요.", createdAt: hoursAgo(6), updatedAt: hoursAgo(6) },
  ];
  return { posts, comments };
}

export function getCommunityCommentThreads(comments = []) {
  const repliesByParent = new Map();
  comments.filter((comment) => comment.parentId).forEach((comment) => {
    repliesByParent.set(comment.parentId, [...(repliesByParent.get(comment.parentId) ?? []), comment]);
  });
  return comments.filter((comment) => !comment.parentId).map((comment) => ({
    ...comment,
    replies: repliesByParent.get(comment.id) ?? [],
  }));
}

export function getCommunityErrorMessage(errorCode = "") {
  if (errorCode === "community_post_daily_limit") return "24시간 동안 글은 5개까지 작성할 수 있습니다.";
  if (errorCode === "community_comment_daily_limit") return "24시간 동안 댓글은 50개까지 작성할 수 있습니다.";
  if (errorCode === "community_notice_admin_required") return "공지는 운영진만 작성할 수 있습니다.";
  if (errorCode.includes("title")) return "제목은 2자 이상 100자 이하로 입력해 주세요.";
  if (errorCode.includes("comment")) return "댓글 내용을 확인해 주세요.";
  if (errorCode.includes("body")) return "본문은 2자 이상 5,000자 이하로 입력해 주세요.";
  return "커뮤니티 요청을 처리하지 못했습니다.";
}

export default function useCommunityController(app) {
  const remote = isSupabaseConfigured;
  const communityAction = app.actions.community;
  const demoBoard = useMemo(() => makeDemoBoard(app.currentUser, app.state.users), [app.currentUserId]);
  const [localPosts, setLocalPosts] = useState(demoBoard.posts);
  const [localComments, setLocalComments] = useState(demoBoard.comments);
  const [remotePosts, setRemotePosts] = useState([]);
  const [remotePopularPosts, setRemotePopularPosts] = useState([]);
  const [page, setPage] = useState({ hasMore: false, nextOffset: 0 });
  const [category, setCategory] = useState("all");
  const [selectedPost, setSelectedPost] = useState(null);
  const [comments, setComments] = useState([]);
  const [canModerate, setCanModerate] = useState(false);
  const [loading, setLoading] = useState(remote);
  const [detailLoading, setDetailLoading] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (remote) return;
    setLocalPosts(demoBoard.posts);
    setLocalComments(demoBoard.comments);
    setSelectedPost(null);
    setComments([]);
  }, [demoBoard, remote]);

  const loadPosts = useCallback(async (append = false) => {
    if (!remote) return;
    setLoading(true);
    setError("");
    try {
      const result = await communityAction("list", { category, limit: 30, offset: append ? page.nextOffset : 0 });
      if (!result || result.ok === false) throw new Error(result?.error || "community_list_failed");
      setRemotePosts((current) => append
        ? [...current, ...result.posts.filter((post) => !current.some((item) => item.id === post.id))]
        : result.posts);
      setRemotePopularPosts(result.popularPosts ?? []);
      setPage(result.page ?? { hasMore: false, nextOffset: 0 });
      setCanModerate(result.canModerate === true);
    } catch (loadError) {
      setError(getCommunityErrorMessage(loadError.message));
    } finally {
      setLoading(false);
    }
  }, [category, communityAction, page.nextOffset, remote]);

  useEffect(() => {
    if (remote && app.remoteReady) void loadPosts(false);
  }, [app.remoteReady, category, remote]);

  const posts = remote
    ? remotePosts
    : localPosts.filter((post) => category === "all" || post.category === category);
  const popularPosts = remote ? remotePopularPosts : selectPopularCommunityPosts(localPosts);
  const commentThreads = useMemo(() => getCommunityCommentThreads(comments), [comments]);

  const openPost = async (post) => {
    setSelectedPost(post);
    setComments([]);
    setError("");
    if (!remote) {
      setSelectedPost(localPosts.find((item) => item.id === post.id) ?? post);
      setComments(localComments.filter((comment) => comment.postId === post.id));
      return;
    }
    setDetailLoading(true);
    try {
      const result = await communityAction("detail", { postId: post.id });
      if (!result || result.ok === false) throw new Error(result?.error || "community_detail_failed");
      setSelectedPost(result.post);
      setComments(result.comments ?? []);
      setCanModerate(result.canModerate === true);
    } catch (detailError) {
      setError(getCommunityErrorMessage(detailError.message));
      setSelectedPost(null);
    } finally {
      setDetailLoading(false);
    }
  };

  const applyPostUpdate = (post) => {
    setRemotePosts((current) => current.map((item) => item.id === post.id ? { ...item, ...post } : item));
    setRemotePopularPosts((current) => selectPopularCommunityPosts(current.map((item) => item.id === post.id ? { ...item, ...post } : item)));
    setSelectedPost(post);
  };

  const savePost = async (draft, postId = "") => {
    setPending(true);
    setError("");
    try {
      if (remote) {
        const operation = postId ? "updatePost" : "createPost";
        const result = await communityAction(operation, { postId, post: draft });
        if (!result || result.ok === false) throw new Error(result?.error || "community_post_save_failed");
        await loadPosts(false);
        setSelectedPost(result.post);
        setComments(result.comments ?? []);
        return true;
      }
      const normalized = normalizeCommunityPostDraft(draft, canModerate ? 30 : 0);
      const now = new Date().toISOString();
      const savedPost = postId
        ? { ...localPosts.find((post) => post.id === postId), ...normalized, updatedAt: now }
        : { id: makeLocalId("community"), authorId: app.currentUserId, author: app.currentUser, ...normalized, likeCount: 0, commentCount: 0, liked: false, createdAt: now, updatedAt: now };
      setLocalPosts((current) => postId
        ? current.map((post) => post.id === postId ? savedPost : post)
        : [savedPost, ...current]);
      setSelectedPost(savedPost);
      setComments(localComments.filter((comment) => comment.postId === savedPost.id));
      return true;
    } catch (saveError) {
      setError(getCommunityErrorMessage(saveError.message));
      return false;
    } finally {
      setPending(false);
    }
  };

  const deletePost = async (postId) => {
    setPending(true);
    setError("");
    try {
      if (remote) {
        const result = await communityAction("deletePost", { postId });
        if (!result || result.ok === false) throw new Error(result?.error || "community_post_delete_failed");
        await loadPosts(false);
      } else {
        setLocalPosts((current) => current.filter((post) => post.id !== postId));
        setLocalComments((current) => current.filter((comment) => comment.postId !== postId));
      }
      setSelectedPost(null);
      setComments([]);
      return true;
    } catch (deleteError) {
      setError(getCommunityErrorMessage(deleteError.message));
      return false;
    } finally {
      setPending(false);
    }
  };

  const toggleLike = async (postId) => {
    if (pending) return;
    setPending(true);
    setError("");
    try {
      if (remote) {
        const result = await communityAction("toggleLike", { postId });
        if (!result || result.ok === false) throw new Error(result?.error || "community_like_failed");
        const nextPost = { ...(selectedPost?.id === postId ? selectedPost : remotePosts.find((post) => post.id === postId)), liked: result.liked, likeCount: result.likeCount };
        applyPostUpdate(nextPost);
      } else {
        const currentPost = localPosts.find((post) => post.id === postId);
        const nextPost = currentPost ? { ...currentPost, liked: !currentPost.liked, likeCount: Math.max(0, currentPost.likeCount + (currentPost.liked ? -1 : 1)) } : null;
        if (nextPost) setLocalPosts((current) => current.map((post) => post.id === postId ? nextPost : post));
        if (nextPost) setSelectedPost(nextPost);
      }
    } catch (likeError) {
      setError(getCommunityErrorMessage(likeError.message));
    } finally {
      setPending(false);
    }
  };

  const saveComment = async (body, parentId = null) => {
    setPending(true);
    setError("");
    try {
      const safeBody = normalizeCommunityCommentBody(body);
      if (remote) {
        const result = await communityAction("createComment", { postId: selectedPost.id, parentId, body: safeBody });
        if (!result || result.ok === false) throw new Error(result?.error || "community_comment_save_failed");
        applyPostUpdate(result.post);
        setComments(result.comments ?? []);
      } else {
        const now = new Date().toISOString();
        const comment = { id: makeLocalId("community_comment"), postId: selectedPost.id, authorId: app.currentUserId, author: app.currentUser, parentId, body: safeBody, createdAt: now, updatedAt: now };
        setLocalComments((current) => [...current, comment]);
        setComments((current) => [...current, comment]);
        setLocalPosts((current) => current.map((post) => post.id === selectedPost.id ? { ...post, commentCount: post.commentCount + 1 } : post));
        setSelectedPost((current) => ({ ...current, commentCount: current.commentCount + 1 }));
      }
      return true;
    } catch (commentError) {
      setError(getCommunityErrorMessage(commentError.message));
      return false;
    } finally {
      setPending(false);
    }
  };

  const deleteComment = async (commentId) => {
    setPending(true);
    setError("");
    try {
      if (remote) {
        const result = await communityAction("deleteComment", { commentId });
        if (!result || result.ok === false) throw new Error(result?.error || "community_comment_delete_failed");
        applyPostUpdate(result.post);
        setComments(result.comments ?? []);
      } else {
        const deletedIds = new Set([commentId, ...localComments.filter((comment) => comment.parentId === commentId).map((comment) => comment.id)]);
        setLocalComments((current) => current.filter((comment) => !deletedIds.has(comment.id)));
        setComments((current) => current.filter((comment) => !deletedIds.has(comment.id)));
        setLocalPosts((current) => current.map((post) => post.id === selectedPost.id ? { ...post, commentCount: Math.max(0, post.commentCount - deletedIds.size) } : post));
        setSelectedPost((current) => ({ ...current, commentCount: Math.max(0, current.commentCount - deletedIds.size) }));
      }
      return true;
    } catch (commentError) {
      setError(getCommunityErrorMessage(commentError.message));
      return false;
    } finally {
      setPending(false);
    }
  };

  const closePost = useCallback(() => {
    setSelectedPost(null);
    setComments([]);
  }, []);

  return {
    posts, popularPosts, page, category, setCategory, selectedPost, comments, commentThreads,
    canModerate, loading, detailLoading, pending, error, setError,
    openPost, closePost,
    loadMore: () => loadPosts(true), savePost, deletePost, toggleLike, saveComment, deleteComment,
  };
}
