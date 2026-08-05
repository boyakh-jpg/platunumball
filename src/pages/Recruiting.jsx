import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  useLocation,
  useNavigate,
  useSearchParams,
} from "react-router-dom";
import BasketballLoader from "../components/common/BasketballLoader.jsx";
import useBodyScrollLock from "../hooks/useBodyScrollLock.js";
import {
  REMOTE_LIST_REFRESH_MIN_INTERVAL_MS,
} from "../lib/constants.js";
import {
  getProfileRegionSelection,
  REGION_TREE,
} from "../lib/profileSetup.js";
import {
  getRegisteredCourts,
} from "../lib/courts.js";
import {
  isSyntheticMatchRoomId,
  isNationalRecruitingPost,
} from "../lib/recruiting.js";
import {
  getLocalDateInputValue,
  isInstantRoom,
} from "../lib/matchUtils.js";
import {
  getStartDateFilterOptions,
} from "../lib/recruitingPage.js";
import "../styles/recruiting-arena.css";
import "../styles/matches-arena.css";
import "../styles/match-list-card.css";

import {
  RECRUITING_FILTER_DEBOUNCE_MS,
  RECRUITING_FILTER_PAGE_LIMIT,
  RecruitingRoomLoadFailedView,
  RecruitingRoomLoadingView,
  RecruitingRoomModal,
  canShowRecruitingQueuePost,
  getRecruitingRoomListStatus,
  isExpiredInstantRecruitingPost,
  isLocalRecruitingPost,
  isRegionRecruitingPost,
  stripRegionSuffix,
  useDebouncedValue,
} from "../components/recruiting/RecruitingRoomModal.jsx";
import RecruitingPageView from "./RecruitingPageView.jsx";

export { RecruitingRoomLoadFailedView, RecruitingRoomLoadingView, RecruitingRoomModal, getRecruitingRoomListStatus };

function RecruitingReady({ app, readOnly = false }) {
  const location = useLocation();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const targetPostId = searchParams.get("post") ?? "";
  const myTeams = useMemo(
    () => app.state.teams.filter((team) => team.members.some((member) => member.userId === app.currentUser.id)),
    [app.currentUser.id, app.state.teams],
  );
  const registeredCourts = useMemo(() => getRegisteredCourts(app.state), [app.state]);
  const courtById = useMemo(() => Object.fromEntries(registeredCourts.map((court) => [court.id, court])), [registeredCourts]);
  const courtByName = useMemo(() => Object.fromEntries(registeredCourts.map((court) => [court.name, court])), [registeredCourts]);
  const myTeamIds = useMemo(() => myTeams.map((team) => team.id), [myTeams]);
  const userById = useMemo(() => Object.fromEntries(app.state.users.map((user) => [user.id, user])), [app.state.users]);
  const teamById = useMemo(() => Object.fromEntries(app.state.teams.map((team) => [team.id, team])), [app.state.teams]);
  const defaultRegionSelection = useMemo(
    () => getProfileRegionSelection(app.currentUser),
    [app.currentUser.region, app.currentUser.regionDistrict, app.currentUser.regionSido],
  );
  const [queue, setQueue] = useState("all");
  const [regionFilterSido, setRegionFilterSido] = useState(defaultRegionSelection.sido);
  const [regionFilterDistrict, setRegionFilterDistrict] = useState(defaultRegionSelection.district);
  const [modeFilter, setModeFilter] = useState("all");
  const [startFilter, setStartFilter] = useState("instant");
  const [queueControlsOpen, setQueueControlsOpen] = useState(true);
  const [selectedPostId, setSelectedPostId] = useState(null);
  const [selectedPostDetailLoadingId, setSelectedPostDetailLoadingId] = useState(null);
  const [selectedPostDetailFailedId, setSelectedPostDetailFailedId] = useState(null);
  const targetPostLoadRef = useRef("");
  const selectedPostRefreshRef = useRef("");
  const regionLoadRef = useRef("");
  const lastRecruitingRefreshAtRef = useRef(0);
  const selectedRegionGroup = REGION_TREE.find((region) => region.sido === regionFilterSido) ?? REGION_TREE[0] ?? { districts: [] };
  const regionDistrictOptions = selectedRegionGroup.districts ?? [];
  const selectedRegionDistrict = regionDistrictOptions.includes(regionFilterDistrict) ? regionFilterDistrict : regionDistrictOptions[0] ?? defaultRegionSelection.district;
  const regionFilter = selectedRegionDistrict;
  const selectedRegionKey = stripRegionSuffix(selectedRegionDistrict);
  const startDateKey = getLocalDateInputValue();
  const startDateOptions = useMemo(() => getStartDateFilterOptions(), [startDateKey]);
  const startFilterLabel = startDateOptions.find((option) => option.id === startFilter)?.label ?? "전체 시작일";
  const filterRequestKey = `${regionFilterSido}:${selectedRegionKey}:${startFilter}`;
  const debouncedFilterRequestKey = useDebouncedValue(filterRequestKey, RECRUITING_FILTER_DEBOUNCE_MS);
  const filterRequestSettled = filterRequestKey === debouncedFilterRequestKey;

  const selectRegionSido = (event) => {
    const nextSido = event.target.value;
    const nextGroup = REGION_TREE.find((region) => region.sido === nextSido) ?? REGION_TREE[0];
    setRegionFilterSido(nextGroup?.sido ?? defaultRegionSelection.sido);
    setRegionFilterDistrict(nextGroup?.districts?.[0] ?? defaultRegionSelection.district);
  };
  const selectRegionDistrict = (event) => {
    setRegionFilterDistrict(event.target.value);
  };

  useEffect(() => {
    if (!targetPostId) return;
    setQueue("all");
    setModeFilter("all");
  }, [targetPostId]);

  const refreshRecruitingFromServer = useCallback(async ({ force = false } = {}) => {
    if (!app.remoteReady || !app.currentUser.id || targetPostId || !filterRequestSettled) return false;
    const loadRecruitingRegion = app.actions.loadRecruitingRegion;
    if (!loadRecruitingRegion) return false;
    const now = Date.now();
    if (!force && now - lastRecruitingRefreshAtRef.current < REMOTE_LIST_REFRESH_MIN_INTERVAL_MS) return false;
    const loadKey = `${app.currentUser.id}:${selectedRegionKey}:${startFilter}`;
    if (regionLoadRef.current === loadKey) return false;
    regionLoadRef.current = loadKey;
    lastRecruitingRefreshAtRef.current = now;
    try {
      const count = await loadRecruitingRegion({
        regionScope: "region",
        regionKey: selectedRegionKey,
        limit: startFilter !== "all" ? RECRUITING_FILTER_PAGE_LIMIT : undefined,
        startFilter,
        includeFeedCounts: false,
      });
      if (count === false) {
        lastRecruitingRefreshAtRef.current = 0;
        return false;
      }
      return true;
    } catch {
      lastRecruitingRefreshAtRef.current = 0;
      return false;
    } finally {
      if (regionLoadRef.current === loadKey) regionLoadRef.current = "";
    }
  }, [app.actions.loadRecruitingRegion, app.currentUser.id, app.remoteReady, filterRequestSettled, selectedRegionKey, startFilter, targetPostId]);

  useEffect(() => {
    lastRecruitingRefreshAtRef.current = 0;
  }, [app.currentUser.id]);

  useEffect(() => {
    void refreshRecruitingFromServer({ force: true });
  }, [refreshRecruitingFromServer]);

  useEffect(() => {
    if (!app.remoteReady || !app.currentUser.id || targetPostId) return undefined;
    const refreshWhenVisible = () => {
      if (document.visibilityState !== "visible") return;
      void refreshRecruitingFromServer();
    };
    window.addEventListener("focus", refreshWhenVisible);
    document.addEventListener("visibilitychange", refreshWhenVisible);
    return () => {
      window.removeEventListener("focus", refreshWhenVisible);
      document.removeEventListener("visibilitychange", refreshWhenVisible);
    };
  }, [app.currentUser.id, app.remoteReady, refreshRecruitingFromServer, targetPostId]);

  const scopedPosts = useMemo(() => {
    return [...(app.state.recruitingPosts ?? [])]
      .filter((post) => post.status === "open")
      .filter((post) => !isExpiredInstantRecruitingPost(post))
      .filter((post) => canShowRecruitingQueuePost(post, {
        targetPostId,
      }))
      .filter((post) => {
        if (post.id === targetPostId) return true;
        if (post.visibility === "private") return false;
        return isRegionRecruitingPost(post, selectedRegionKey, app.currentUser) || isNationalRecruitingPost(post, app.state);
      })
      .filter((post) => queue === "all" || (queue === "ranked" ? post.ranked !== false : post.ranked === false))
      .filter((post) => modeFilter === "all" || post.mode === modeFilter)
      .filter((post) => {
        if (startFilter === "all" || post.id === targetPostId) return true;
        if (startFilter === "instant") return isInstantRoom(post);
        return !isInstantRoom(post) && post.scheduledDate === startFilter;
      });
  }, [app.currentUser, app.state, modeFilter, queue, selectedRegionKey, startFilter, targetPostId]);

  const posts = useMemo(() => {
    return scopedPosts.sort((a, b) => {
      const aLocal = Number(isLocalRecruitingPost(a, app.currentUser));
      const bLocal = Number(isLocalRecruitingPost(b, app.currentUser));
      const aNational = Number(isNationalRecruitingPost(a, app.state));
      const bNational = Number(isNationalRecruitingPost(b, app.state));
      const aInstant = Number(isInstantRoom(a));
      const bInstant = Number(isInstantRoom(b));
      return bInstant - aInstant || bLocal - aLocal || bNational - aNational || new Date(b.createdAt) - new Date(a.createdAt);
    });
  }, [app.currentUser, app.state, scopedPosts]);
  const queueListLoading = !posts.length && (!filterRequestSettled || app.recruitingPagination?.loading);

  const selectedPost = selectedPostId
    ? app.state.recruitingPosts.find((post) => post.id === selectedPostId)
    : null;
  const selectedPostPending = Boolean(selectedPostId && !selectedPost);
  const selectedPostNeedsDetail = Boolean(selectedPost?.listCardOnly);
  const selectedPostDetailFailed = Boolean(selectedPostId && selectedPostDetailFailedId === selectedPostId && (!selectedPost || selectedPostNeedsDetail));
  const selectedPostDetailLoading = Boolean(selectedPostId && !selectedPostDetailFailed && (selectedPostDetailLoadingId === selectedPostId || selectedPostNeedsDetail));
  const requestSelectedPostDetail = (postId) => {
    if (!postId) return;
    if (isSyntheticMatchRoomId(postId)) {
      setSelectedPostDetailLoadingId(null);
      setSelectedPostDetailFailedId(postId);
      return;
    }
    setSelectedPostDetailFailedId((currentId) => currentId === postId ? null : currentId);
    setSelectedPostDetailLoadingId(postId);
    Promise.resolve(app.actions.loadRecruitingPost?.(postId)).then((count) => {
      if (!count) setSelectedPostDetailFailedId(postId);
    }).finally(() => {
      setSelectedPostDetailLoadingId((currentId) => currentId === postId ? null : currentId);
    });
  };
  const openSelectedPost = (postId) => {
    if (!postId) return;
    selectedPostRefreshRef.current = "";
    setSelectedPostDetailFailedId(null);
    setSelectedPostDetailLoadingId(postId);
    setSelectedPostId(postId);
  };
  const closeSelectedPost = () => {
    selectedPostRefreshRef.current = "";
    setSelectedPostId(null);
    setSelectedPostDetailLoadingId(null);
    setSelectedPostDetailFailedId(null);
    if (targetPostId) {
      const next = new URLSearchParams(searchParams);
      next.delete("post");
      setSearchParams(next, { replace: true });
    }
  };
  useBodyScrollLock(Boolean(selectedPost) || selectedPostPending || selectedPostDetailLoading);

  useEffect(() => {
    if (!targetPostId || !app.remoteReady) return;
    const targetPost = app.state.recruitingPosts.find((post) => post.id === targetPostId);
    if (targetPost) {
      if (targetPostLoadRef.current === targetPostId && app.currentUser.id) {
        selectedPostRefreshRef.current = `${targetPostId}:${app.currentUser.id}`;
      }
      targetPostLoadRef.current = "";
      return;
    }
    if (targetPostLoadRef.current === targetPostId) return;
    targetPostLoadRef.current = targetPostId;
    requestSelectedPostDetail(targetPostId);
  }, [app.actions, app.currentUser.id, app.remoteReady, app.state.recruitingPosts, targetPostId]);

  useEffect(() => {
    if (!targetPostId) return;
    setSelectedPostDetailLoadingId(targetPostId);
    setSelectedPostId(targetPostId);
  }, [targetPostId]);

  useEffect(() => {
    if (!selectedPostId) {
      selectedPostRefreshRef.current = "";
      setSelectedPostDetailLoadingId(null);
      setSelectedPostDetailFailedId(null);
      return;
    }
    if (!app.remoteReady || !app.currentUser.id) return;
    if (selectedPostDetailFailed) return;
    const explicitDetailReload = selectedPostDetailLoadingId === selectedPostId;
    if (!explicitDetailReload && selectedPost && selectedPost.listCardOnly !== true) {
      setSelectedPostDetailFailedId((currentId) => currentId === selectedPostId ? null : currentId);
      setSelectedPostDetailLoadingId((currentId) => currentId === selectedPostId ? null : currentId);
      return;
    }
    const refreshKey = `${selectedPostId}:${app.currentUser.id}`;
    if (!explicitDetailReload && selectedPostRefreshRef.current === refreshKey && selectedPost?.listCardOnly !== true) return;
    selectedPostRefreshRef.current = refreshKey;
    requestSelectedPostDetail(selectedPostId);
  }, [app.actions, app.currentUser.id, app.remoteReady, selectedPost?.listCardOnly, selectedPostDetailFailed, selectedPostDetailLoadingId, selectedPostId]);

  useEffect(() => {
    if (!targetPostId) return;
    const targetPost = app.state.recruitingPosts.find((post) => post.id === targetPostId && post.status !== "closed");
    if (!targetPost) return;
    setSelectedPostId(targetPostId);
  }, [app.state.recruitingPosts, targetPostId]);

  useEffect(() => {
    if (!targetPostId || !posts.some((post) => post.id === targetPostId)) return undefined;
    const frame = window.requestAnimationFrame(() => {
      document.getElementById(`recruiting-room-${targetPostId}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [posts, targetPostId]);

  const rankedCount = scopedPosts.filter((post) => post.ranked !== false).length;
  const friendlyCount = scopedPosts.length - rankedCount;

  const selectStartFilter = (nextFilter) => {
    setStartFilter((current) => (current === nextFilter ? "all" : nextFilter));
  };

  return <RecruitingPageView {...{
    scopedPosts, rankedCount, friendlyCount, queueControlsOpen, posts,
    setQueueControlsOpen, regionFilterSido, selectRegionSido, selectedRegionDistrict, selectRegionDistrict,
    regionDistrictOptions, queue, setQueue, modeFilter, setModeFilter,
    startDateOptions, startFilter, selectStartFilter, startFilterLabel, app,
    userById, teamById, myTeamIds, courtById, courtByName,
    targetPostId, openSelectedPost, queueListLoading, selectedPostDetailFailed, closeSelectedPost,
    selectedPostRefreshRef, requestSelectedPostDetail, selectedPostId, selectedPost, selectedPostDetailLoading,
    navigate, location, setSelectedPostId, selectedPostPending, readOnly,
  }} />;
}

export default function Recruiting({ app, readOnly = false }) {
  if (!app?.currentUser?.id) {
    return <BasketballLoader overlay label="프로필 불러오는 중" />;
  }
  if (app.remoteReady === false) {
    return null;
  }
  return <RecruitingReady app={app} readOnly={readOnly} />;
}
