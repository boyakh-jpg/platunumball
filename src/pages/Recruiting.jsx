import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  Link,
  useLocation,
  useNavigate,
  useSearchParams,
} from "react-router-dom";
import { CalendarDays } from "lucide-react";
import BasketballLoader from "../components/common/BasketballLoader.jsx";
import Button from "../components/common/Button.jsx";
import EmptyState from "../components/common/EmptyState.jsx";
import MatchListCard from "../components/match/MatchListCard.jsx";
import useBodyScrollLock from "../hooks/useBodyScrollLock.js";
import {
  REMOTE_LIST_REFRESH_MIN_INTERVAL_MS,
  REMOTE_CLIENT_RECRUITING_LIMIT,
} from "../lib/constants.js";
import {
  getLoginPath,
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
  getRoomScheduleLabel,
  getRoomVisibilityLabel,
  isInstantRoom,
} from "../lib/matchUtils.js";
import {
  getRecruitingDisplayTitle,
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
  isRegionRecruitingPost,
  stripRegionSuffix,
  useDebouncedValue,
} from "../components/recruiting/RecruitingRoomModal.jsx";
import RecruitingPageView from "./RecruitingPageView.jsx";

export { RecruitingRoomLoadFailedView, RecruitingRoomLoadingView, RecruitingRoomModal, getRecruitingRoomListStatus };

const PUBLIC_RECRUITING_TIMEOUT_MS = 10_000;
const REGION_FILTER_ALL = "__all__";
const REGION_FILTER_MINE = "__mine__";

export function resolveGuestRecruitingTarget(feed, targetPostId) {
  if (!targetPostId) return { post: null, status: "" };
  const listedPost = (feed?.posts ?? []).find((post) => post.id === targetPostId) ?? null;
  if (listedPost) return { post: listedPost, status: "open" };
  if (feed?.requestedRecruitingId !== targetPostId) return { post: null, status: "loading" };
  const requested = feed?.requestedRecruiting;
  if (requested?.status === "open" && requested?.post?.id === targetPostId) {
    return { post: requested.post, status: "open" };
  }
  if (feed?.loading) return { post: null, status: "loading" };
  if (feed?.error) return { post: null, status: "error" };
  return { post: null, status: requested?.status || "not_found" };
}

export function getGuestRecruitingUnavailableCopy(status) {
  if (status === "private") {
    return { title: "비공개 방입니다", description: "이 공유 링크로는 방을 볼 수 없습니다." };
  }
  if (status === "closed") {
    return { title: "종료된 방입니다", description: "모집이 끝났거나 방이 닫혔습니다." };
  }
  if (status === "error") {
    return { title: "방을 불러올 수 없음", description: "잠시 후 다시 시도해 주세요." };
  }
  return { title: "방을 찾을 수 없습니다", description: "링크가 잘못됐거나 방이 삭제됐습니다." };
}

function GuestRecruiting({ app }) {
  const location = useLocation();
  const [searchParams, setSearchParams] = useSearchParams();
  const [reloadKey, setReloadKey] = useState(0);
  const [regionFilterSido, setRegionFilterSido] = useState(REGION_FILTER_ALL);
  const [regionFilterDistrict, setRegionFilterDistrict] = useState("");
  const [feed, setFeed] = useState({ loading: true, error: false, openCount: 0, posts: [], requestedRecruitingId: "", requestedRecruiting: null });
  const targetPostId = searchParams.get("post") ?? "";
  const selectedRegionGroup = REGION_TREE.find((region) => region.sido === regionFilterSido) ?? REGION_TREE[0] ?? { districts: [] };
  const regionDistrictOptions = regionFilterSido === REGION_FILTER_ALL ? [] : selectedRegionGroup.districts ?? [];
  const selectedRegionDistrict = regionDistrictOptions.includes(regionFilterDistrict) ? regionFilterDistrict : regionDistrictOptions[0] ?? "";
  const selectedRegionKey = stripRegionSuffix(selectedRegionDistrict);
  const target = resolveGuestRecruitingTarget(feed, targetPostId);
  const selectedPost = target.post;
  const unavailableCopy = targetPostId && !selectedPost && !["", "loading"].includes(target.status)
    ? getGuestRecruitingUnavailableCopy(target.status)
    : null;
  useBodyScrollLock(Boolean(selectedPost || unavailableCopy));

  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    const timeoutId = window.setTimeout(() => controller.abort(), PUBLIC_RECRUITING_TIMEOUT_MS);
    setFeed((current) => ({ ...current, loading: true, error: false, requestedRecruitingId: targetPostId, requestedRecruiting: null }));
    const requestParams = new URLSearchParams({ recruitingLimit: String(REMOTE_CLIENT_RECRUITING_LIMIT) });
    if (targetPostId) requestParams.set("recruitingPostId", targetPostId);
    if (selectedRegionKey) requestParams.set("recruitingRegion", selectedRegionKey);
    fetch(`/api/landing/stats?${requestParams.toString()}`, {
      method: "GET",
      headers: { Accept: "application/json" },
      signal: controller.signal,
    })
      .then((response) => {
        if (!response.ok) throw new Error("public_recruiting_load_failed");
        return response.json();
      })
      .then((payload) => {
        if (!active) return;
        const posts = Array.isArray(payload?.feed?.openRecruiting)
          ? payload.feed.openRecruiting.filter((post) => typeof post?.id === "string").slice(0, REMOTE_CLIENT_RECRUITING_LIMIT)
          : [];
        const openCount = Number(payload?.stats?.openRecruiting);
        setFeed({
          loading: false,
          error: false,
          openCount: Number.isSafeInteger(openCount) && openCount >= 0 ? openCount : posts.length,
          posts,
          requestedRecruitingId: targetPostId,
          requestedRecruiting: payload?.feed?.requestedRecruiting ?? null,
        });
      })
      .catch(() => {
        if (active) {
          setFeed((current) => ({ ...current, loading: false, error: true }));
        }
      })
      .finally(() => window.clearTimeout(timeoutId));
    return () => {
      active = false;
      window.clearTimeout(timeoutId);
      controller.abort();
    };
  }, [reloadKey, selectedRegionKey, targetPostId]);

  const loginPath = getLoginPath(`${location.pathname}${location.search}${location.hash}`);
  const openRoom = (post) => {
    const next = new URLSearchParams(searchParams);
    next.set("post", post.id);
    setSearchParams(next);
  };
  const closeRoom = () => {
    const next = new URLSearchParams(searchParams);
    next.delete("post");
    setSearchParams(next, { replace: true });
  };
  const posts = feed.posts;
  const rankedCount = posts.filter((post) => post.ranked !== false).length;
  const selectRegionSido = (event) => {
    const nextSido = event.target.value;
    setRegionFilterSido(nextSido);
    setRegionFilterDistrict(REGION_TREE.find((region) => region.sido === nextSido)?.districts?.[0] ?? "");
  };

  return (
    <div className="page-stack arena-recruit-page">
      <section className="arena-recruit-hero ui-page-hero ui-design-app-hero">
        <div className="arena-hero-copy ui-page-hero__copy">
          <span className="eyebrow">PUBLIC MATCH QUEUE</span>
          <h1>공개 매칭</h1>
          <p>현재 서버에 등록된 공개 모집만 표시합니다.</p>
        </div>
        <div className="arena-hero-panel ui-liquid-glass">
          <div className="arena-hero-stats ui-liquid-glass-segments">
            <span><strong>{regionFilterSido === REGION_FILTER_ALL ? feed.openCount : posts.length}</strong>OPEN</span>
            <span><strong>{rankedCount}</strong>RANKED</span>
            <span><strong>{posts.length - rankedCount}</strong>FRIENDLY</span>
          </div>
          <Button as={Link} to={loginPath}>로그인하면 참가 가능</Button>
        </div>
      </section>

      <section className="arena-queue-controls ui-design-soft-surface">
        <div className="section-title-row arena-queue-controls-head">
          <div><span className="eyebrow">REGION FILTER</span><strong>{posts.length}개 표시</strong></div>
        </div>
        <div className="arena-filter-bar" aria-label="지역 필터">
          <label className="arena-filter-select arena-region-sido-filter">
            <select className="ui-control" aria-label="시도" value={regionFilterSido} onChange={selectRegionSido}>
              <option value={REGION_FILTER_ALL}>전체</option>
              {REGION_TREE.map((region) => <option key={region.sido} value={region.sido}>{region.sido}</option>)}
            </select>
          </label>
          <label className="arena-filter-select arena-region-district-filter">
            <select className="ui-control" aria-label="시군구" value={selectedRegionDistrict} onChange={(event) => setRegionFilterDistrict(event.target.value)} disabled={!regionDistrictOptions.length}>
              {!regionDistrictOptions.length ? <option value="">전체 지역</option> : null}
              {regionDistrictOptions.map((district) => <option key={district} value={district}>{district}</option>)}
            </select>
          </label>
        </div>
      </section>

      <section className="arena-recruit-list" aria-label="공개 매칭 목록">
        {posts.length ? posts.map((post) => (
          <MatchListCard
            id={`recruiting-room-${post.id}`}
            key={post.id}
            status={{ label: "대기방", tone: "orange" }}
            mode={post.mode}
            visibility={getRoomVisibilityLabel(post)}
            title={getRecruitingDisplayTitle(post)}
            meta={<><CalendarDays size={15} /> {getRoomScheduleLabel(post)} · {[post.region, post.court].filter(Boolean).join(" · ") || "장소 미정"}</>}
            actionLabel="방 보기"
            onOpen={() => openRoom(post)}
            onAction={() => openRoom(post)}
          />
        )) : feed.loading ? (
          <EmptyState tone="loading" title="공개 매칭 불러오는 중" />
        ) : feed.error ? (
          <EmptyState
            tone="error"
            title="공개 매칭을 불러오지 못했습니다"
            description="잠시 후 다시 시도해 주세요."
            action={<Button type="button" onClick={() => setReloadKey((value) => value + 1)}>다시 시도</Button>}
          />
        ) : (
          <EmptyState title="현재 열린 공개 매칭이 없습니다" />
        )}
      </section>
      {selectedPost ? (
        <RecruitingRoomModal app={app} post={selectedPost} readOnly skipInitialDetailLoad onClose={closeRoom} />
      ) : null}
      {unavailableCopy ? (
        <RecruitingRoomLoadFailedView
          onClose={closeRoom}
          onRetry={target.status === "error" ? () => setReloadKey((value) => value + 1) : null}
          title={unavailableCopy.title}
          description={unavailableCopy.description}
        />
      ) : null}
    </div>
  );
}

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
  const [regionFilterSido, setRegionFilterSido] = useState(REGION_FILTER_ALL);
  const [regionFilterDistrict, setRegionFilterDistrict] = useState("");
  const [modeFilter, setModeFilter] = useState("all");
  const [startFilter, setStartFilter] = useState("all");
  const [queueControlsOpen, setQueueControlsOpen] = useState(true);
  const [selectedPostId, setSelectedPostId] = useState(null);
  const [selectedPostDetailLoadingId, setSelectedPostDetailLoadingId] = useState(null);
  const [selectedPostDetailFailedId, setSelectedPostDetailFailedId] = useState(null);
  const targetPostLoadRef = useRef("");
  const selectedPostRefreshRef = useRef("");
  const regionLoadRef = useRef("");
  const lastRecruitingRefreshAtRef = useRef(0);
  const effectiveRegionSido = regionFilterSido === REGION_FILTER_MINE
    ? defaultRegionSelection.sido
    : regionFilterSido;
  const selectedRegionGroup = REGION_TREE.find((region) => region.sido === effectiveRegionSido) ?? REGION_TREE[0] ?? { districts: [] };
  const regionDistrictOptions = regionFilterSido === REGION_FILTER_ALL ? [] : selectedRegionGroup.districts ?? [];
  const preferredDistrict = regionFilterSido === REGION_FILTER_MINE ? defaultRegionSelection.district : regionFilterDistrict;
  const selectedRegionDistrict = regionDistrictOptions.includes(preferredDistrict) ? preferredDistrict : regionDistrictOptions[0] ?? "";
  const selectedRegionKey = stripRegionSuffix(selectedRegionDistrict);
  const regionScope = regionFilterSido === REGION_FILTER_ALL ? "all" : "region";
  const regionFilterLabel = regionScope === "all" ? "전체" : regionFilterSido === REGION_FILTER_MINE
    ? `내 지역 · ${defaultRegionSelection.sido} ${selectedRegionDistrict}`
    : `${effectiveRegionSido} ${selectedRegionDistrict}`;
  const startDateKey = getLocalDateInputValue();
  const startDateOptions = useMemo(() => getStartDateFilterOptions(), [startDateKey]);
  const startFilterLabel = startDateOptions.find((option) => option.id === startFilter)?.label ?? "전체 시작일";
  const filterRequestKey = `${regionScope}:${selectedRegionKey}:${startFilter}`;
  const debouncedFilterRequestKey = useDebouncedValue(filterRequestKey, RECRUITING_FILTER_DEBOUNCE_MS);
  const filterRequestSettled = filterRequestKey === debouncedFilterRequestKey;

  const selectRegionSido = (event) => {
    const nextSido = event.target.value;
    setRegionFilterSido(nextSido);
    if (nextSido === REGION_FILTER_ALL) {
      setRegionFilterDistrict("");
      return;
    }
    if (nextSido === REGION_FILTER_MINE) {
      setRegionFilterDistrict(defaultRegionSelection.district);
      return;
    }
    const nextGroup = REGION_TREE.find((region) => region.sido === nextSido) ?? REGION_TREE[0];
    setRegionFilterDistrict(nextGroup?.districts?.[0] ?? "");
  };
  const selectRegionDistrict = (event) => setRegionFilterDistrict(event.target.value);

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
    const loadKey = `${app.currentUser.id}:${regionScope}:${selectedRegionKey}:${startFilter}`;
    if (regionLoadRef.current === loadKey) return false;
    regionLoadRef.current = loadKey;
    lastRecruitingRefreshAtRef.current = now;
    try {
      const count = await loadRecruitingRegion({
        regionScope,
        regionKey: selectedRegionKey,
        limit: startFilter !== "all" ? RECRUITING_FILTER_PAGE_LIMIT : REMOTE_CLIENT_RECRUITING_LIMIT,
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
  }, [app.actions.loadRecruitingRegion, app.currentUser.id, app.remoteReady, filterRequestSettled, regionScope, selectedRegionKey, startFilter, targetPostId]);

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
        if (regionScope === "all") return true;
        return isRegionRecruitingPost(post, selectedRegionKey, app.currentUser) || isNationalRecruitingPost(post, app.state);
      })
      .filter((post) => queue === "all" || (queue === "ranked" ? post.ranked !== false : post.ranked === false))
      .filter((post) => modeFilter === "all" || post.mode === modeFilter)
      .filter((post) => {
        if (startFilter === "all" || post.id === targetPostId) return true;
        if (startFilter === "instant") return isInstantRoom(post);
        return !isInstantRoom(post) && post.scheduledDate === startFilter;
      });
  }, [app.currentUser, app.state, modeFilter, queue, regionScope, selectedRegionKey, startFilter, targetPostId]);

  const posts = useMemo(() => {
    return scopedPosts.sort((a, b) => {
      const aInstant = Number(isInstantRoom(a));
      const bInstant = Number(isInstantRoom(b));
      return bInstant - aInstant || new Date(b.createdAt) - new Date(a.createdAt);
    });
  }, [scopedPosts]);
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
    regionDistrictOptions, regionFilterLabel, defaultRegionSelection, queue, setQueue, modeFilter, setModeFilter,
    startDateOptions, startFilter, selectStartFilter, startFilterLabel, app,
    userById, teamById, myTeamIds, courtById, courtByName,
    targetPostId, openSelectedPost, queueListLoading, selectedPostDetailFailed, closeSelectedPost,
    selectedPostRefreshRef, requestSelectedPostDetail, selectedPostId, selectedPost, selectedPostDetailLoading,
    navigate, location, setSelectedPostId, selectedPostPending, readOnly,
  }} />;
}

export default function Recruiting({ app, readOnly = false }) {
  if (readOnly) return <GuestRecruiting app={app} />;
  if (!app?.currentUser?.id) {
    return <BasketballLoader overlay label="프로필 불러오는 중" />;
  }
  if (app.remoteReady === false) {
    return null;
  }
  return <RecruitingReady app={app} readOnly={readOnly} />;
}
