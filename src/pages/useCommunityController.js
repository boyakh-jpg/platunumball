import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { isSupabaseConfigured } from "../lib/supabase.js";
import { getLoginPath } from "../lib/profileSetup.js";
import { isLatestRequest } from "../lib/asyncState.js";
import {
  COMMUNITY_POST_ADMIN_CATEGORIES,
  COMMUNITY_POST_CATEGORIES,
  COMMUNITY_PAGE_SIZE,
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
    { id: "community_demo_notice", authorId: secondUser?.id, author: secondUser, category: "notice", title: "게시판 이용 안내", body: "경기 모집은 매칭 메뉴를 이용하고, 이곳에는 농구 이야기와 구장 정보를 남겨 주세요.", pinned: true, viewCount: 42, likeCount: 4, commentCount: 0, liked: false, createdAt: hoursAgo(8), updatedAt: hoursAgo(8) },
    { id: "community_demo_1", authorId: secondUser?.id, author: secondUser, category: "question", title: "오늘 저녁 야외 코트 상태 어떤가요?", body: "비가 그친 뒤 바닥이 말랐는지 궁금합니다. 다녀온 분 있으면 알려 주세요.", pinned: false, viewCount: 31, likeCount: 8, commentCount: 2, liked: false, createdAt: hoursAgo(3), updatedAt: hoursAgo(3) },
    { id: "community_demo_2", authorId: currentUser?.id, author: currentUser, category: "general", title: "처음 3대3 할 때 지키면 좋은 것", body: "공격 전 체크볼과 파울 콜을 먼저 합의하면 경기가 훨씬 매끄럽습니다.", pinned: false, viewCount: 24, likeCount: 5, commentCount: 1, liked: true, createdAt: hoursAgo(10), updatedAt: hoursAgo(10) },
    { id: "community_demo_3", authorId: secondUser?.id, author: secondUser, category: "general", title: "주말 오전 슛 연습", body: "혼자 연습하기 좋은 시간대와 구장을 공유해 봐요.", pinned: false, viewCount: 17, likeCount: 3, commentCount: 0, liked: false, createdAt: hoursAgo(28), updatedAt: hoursAgo(28) },
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
  if (errorCode === "community_photo_admin_required") return "사진 게시글은 운영진만 작성할 수 있습니다.";
  if (errorCode === "community_photo_required") return "사진 게시글에는 사진 1장을 첨부해 주세요.";
  if (errorCode.startsWith("community_photo_")) return "사진을 저장하지 못했습니다. 다른 사진을 선택해 주세요.";
  if (errorCode.includes("title")) return "제목은 2자 이상 100자 이하로 입력해 주세요.";
  if (errorCode.includes("comment")) return "댓글 내용을 확인해 주세요.";
  if (errorCode.includes("body")) return "본문은 2자 이상 5,000자 이하로 입력해 주세요.";
  return "게시판 요청을 처리하지 못했습니다.";
}

export default function useCommunityController(app) {
  const remote = isSupabaseConfigured;
  const communityAction = app.actions.community;
  const demoBoard = useMemo(() => makeDemoBoard(app.currentUser, app.state.users), [app.currentUserId]);
  const [localPosts, setLocalPosts] = useState(demoBoard.posts);
  const [localComments, setLocalComments] = useState(demoBoard.comments);
  const [remotePosts, setRemotePosts] = useState([]);
  const [remotePopularPosts, setRemotePopularPosts] = useState([]);
  const [page, setPage] = useState({ offset: 0, limit: COMMUNITY_PAGE_SIZE, total: 0, hasMore: false });
  const [pageIndex, setPageIndex] = useState(0);
  const [category, setCategory] = useState(COMMUNITY_POST_CATEGORIES[0]);
  const [selectedPost, setSelectedPost] = useState(null);
  const [comments, setComments] = useState([]);
  const [canModerate, setCanModerate] = useState(false);
  const [loading, setLoading] = useState(remote);
  const [detailLoading, setDetailLoading] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const listRequestRef = useRef(0);
  const detailRequestRef = useRef(0);
  const localViewedPostIdsRef = useRef(new Set());

  const requireLogin = () => {
    if (!app.demoPreview) return false;
    const redirect = `${window.location.pathname}${window.location.search}${window.location.hash}`;
    window.location.assign(getLoginPath(redirect));
    return true;
  };

  useEffect(() => {
    if (remote) return;
    setLocalPosts(demoBoard.posts);
    setLocalComments(demoBoard.comments);
    setSelectedPost(null);
    setComments([]);
    localViewedPostIdsRef.current.clear();
  }, [demoBoard, remote]);

  const loadPosts = useCallback(async (targetPage = 0) => {
    if (!remote) return;
    const requestId = ++listRequestRef.current;
    setLoading(true);
    setError("");
    try {
      const result = await communityAction("list", { category, limit: COMMUNITY_PAGE_SIZE, offset: targetPage * COMMUNITY_PAGE_SIZE });
      if (!result || result.ok === false) throw new Error(result?.error || "community_list_failed");
      if (requestId !== listRequestRef.current) return;
      setRemotePosts(result.posts);
      setRemotePopularPosts(result.popularPosts ?? []);
      setPage(result.page ?? { offset: 0, limit: COMMUNITY_PAGE_SIZE, total: 0, hasMore: false });
      setPageIndex(targetPage);
      setCanModerate(result.canModerate === true);
    } catch (loadError) {
      if (requestId === listRequestRef.current) setError(getCommunityErrorMessage(loadError.message));
    } finally {
      if (requestId === listRequestRef.current) setLoading(false);
    }
  }, [category, communityAction, remote]);

  useEffect(() => {
    setPageIndex(0);
    if (remote && app.remoteReady) {
      setRemotePosts([]);
      void loadPosts(0);
    }
  }, [app.remoteReady, category, remote]);

  const filteredLocalPosts = localPosts.filter((post) => post.category === category);
  const posts = remote ? remotePosts : filteredLocalPosts.slice(pageIndex * COMMUNITY_PAGE_SIZE, (pageIndex + 1) * COMMUNITY_PAGE_SIZE);
  const currentPage = remote ? page : {
    offset: pageIndex * COMMUNITY_PAGE_SIZE,
    limit: COMMUNITY_PAGE_SIZE,
    total: filteredLocalPosts.length,
    hasMore: (pageIndex + 1) * COMMUNITY_PAGE_SIZE < filteredLocalPosts.length,
  };
  const popularPosts = remote ? remotePopularPosts : selectPopularCommunityPosts(localPosts);
  const commentThreads = useMemo(() => getCommunityCommentThreads(comments), [comments]);

  const openPost = async (post) => {
    const requestId = ++detailRequestRef.current;
    setSelectedPost(remote && !post.title ? null : post);
    setComments([]);
    setError("");
    if (!remote) {
      const currentPost = localPosts.find((item) => item.id === post.id) ?? post;
      const nextPost = localViewedPostIdsRef.current.has(post.id)
        ? currentPost
        : { ...currentPost, viewCount: Number(currentPost.viewCount ?? 0) + 1 };
      localViewedPostIdsRef.current.add(post.id);
      setLocalPosts((current) => current.map((item) => item.id === post.id ? nextPost : item));
      setSelectedPost(nextPost);
      setComments(localComments.filter((comment) => comment.postId === post.id));
      return;
    }
    setDetailLoading(true);
    try {
      const result = await communityAction("detail", { postId: post.id });
      if (!result || result.ok === false) throw new Error(result?.error || "community_detail_failed");
      if (!isLatestRequest(detailRequestRef.current, requestId)) return;
      setRemotePosts((current) => current.map((item) => item.id === post.id ? { ...item, ...result.post } : item));
      setRemotePopularPosts((current) => current.map((item) => item.id === post.id ? { ...item, ...result.post } : item));
      setSelectedPost(result.post);
      setComments(result.comments ?? []);
      setCanModerate(result.canModerate === true);
    } catch (detailError) {
      if (isLatestRequest(detailRequestRef.current, requestId)) {
        setError(getCommunityErrorMessage(detailError.message));
        setSelectedPost(null);
      }
    } finally {
      if (isLatestRequest(detailRequestRef.current, requestId)) setDetailLoading(false);
    }
  };

  const applyPostUpdate = (post) => {
    setRemotePosts((current) => current.map((item) => item.id === post.id ? { ...item, ...post } : item));
    setRemotePopularPosts((current) => selectPopularCommunityPosts(current.map((item) => item.id === post.id ? { ...item, ...post } : item)));
    setSelectedPost(post);
  };

  const savePost = async (draft, postId = "") => {
    if (requireLogin()) return false;
    setPending(true);
    setError("");
    try {
      if (remote) {
        const operation = postId ? "updatePost" : "createPost";
        const result = await communityAction(operation, { postId, post: draft });
        if (!result || result.ok === false) throw new Error(result?.error || "community_post_save_failed");
        const targetPage = postId ? pageIndex : 0;
        await loadPosts(targetPage);
        setSelectedPost(result.post);
        setComments(result.comments ?? []);
        return true;
      }
      const normalized = normalizeCommunityPostDraft(draft, canModerate ? 30 : 0);
      const now = new Date().toISOString();
      const savedPost = postId
        ? { ...localPosts.find((post) => post.id === postId), ...normalized, updatedAt: now }
        : { id: makeLocalId("community"), authorId: app.currentUserId, author: app.currentUser, ...normalized, viewCount: 0, likeCount: 0, commentCount: 0, liked: false, createdAt: now, updatedAt: now };
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
    if (requireLogin()) return false;
    setPending(true);
    setError("");
    try {
      if (remote) {
        const result = await communityAction("deletePost", { postId });
        if (!result || result.ok === false) throw new Error(result?.error || "community_post_delete_failed");
        const targetPage = remotePosts.length === 1 && pageIndex > 0 ? pageIndex - 1 : pageIndex;
        await loadPosts(targetPage);
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
    if (requireLogin()) return;
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
    if (requireLogin()) return false;
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
    if (requireLogin()) return false;
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
    detailRequestRef.current += 1;
    setSelectedPost(null);
    setComments([]);
    setDetailLoading(false);
  }, []);

  return {
    posts, popularPosts, page: currentPage, pageIndex, category, setCategory, selectedPost, comments, commentThreads,
    canModerate,
    canWriteCategory: !app.demoPreview && (canModerate || !COMMUNITY_POST_ADMIN_CATEGORIES.includes(category)),
    loading, detailLoading, pending, error, setError,
    requireLogin,
    openPost, closePost,
    goToPage: (targetPage) => {
      const maxPage = Math.max(0, Math.ceil(currentPage.total / COMMUNITY_PAGE_SIZE) - 1);
      const nextPage = Math.max(0, Math.min(maxPage, Math.floor(Number(targetPage) || 0)));
      setPageIndex(nextPage);
      if (remote) {
        setRemotePosts([]);
        void loadPosts(nextPage);
      }
    },
    savePost, deletePost, toggleLike, saveComment, deleteComment,
  };
}
