import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate, useSearchParams } from "react-router-dom";
import useBodyScrollLock from "../hooks/useBodyScrollLock.js";
import { getRegisteredCourts } from "../lib/courts.js";
import { addDateDays, getLocalDateInputValue, getMatchListScope, isMatchListInitialLoading, MATCH_LIST_SCOPES, MATCH_LIST_STATUSES, selectMatchListMatches, isMatchInPlayMenu } from "../lib/matchUtils.js";
import { REMOTE_LIST_REFRESH_MIN_INTERVAL_MS } from "../lib/constants.js";
import { getRecruitingLobby, getRecruitingPostTerminalState } from "../lib/recruiting.js";
import { getTournamentTeamIds } from "../data/tournamentMappers.js";
import {
  VIEWS,
  VIEW_IDS,
  PANEL_MODES,
  RELATION_FILTER_IDS,
  BRANCH_FILTER_IDS,
  getMatchDate,
  isInstantScheduleRoom,
  isExpiredInstantScheduleRoom,
  matchesRecruitingScheduleDate,
  hasAssignedTeamSchedule,
  getMonthKey,
  getSearchParamValue,
  isDateParam,
  isMonthParam,
  shouldIncludeScheduleWindow,
  getCalendarDays,
  getMatchScheduleRelation,
  getMatchTeamScheduleRelation,
  getRecruitingScheduleRelation,
  isRecruitingScheduleRelatedToUser,
  matchesScheduleRelation,
  matchesScheduleBranch,
  getRecruitingRoomsForView,
  getScheduleItemsForView,
} from "./matchesPageSelectors.js";
import useMatchAttendanceQrScan from "./useMatchAttendanceQrScan.js";
import {
  requestMatchDetailOnce,
  useSelectedMatchRoom,
} from "./matchesPageModel.js";

export default function useMatchesPageController({
  app
}) {
const location = useLocation();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [viewId, setViewId] = useState(() => getSearchParamValue(searchParams, "view", VIEW_IDS, "active"));
  const [panelMode, setPanelMode] = useState(() => getSearchParamValue(searchParams, "panel", PANEL_MODES, "schedule"));
  const [branchFilter, setBranchFilter] = useState(() => getSearchParamValue(searchParams, "branch", BRANCH_FILTER_IDS, "all"));
  const [relationFilter, setRelationFilter] = useState(() => getSearchParamValue(searchParams, "relation", RELATION_FILTER_IDS, "all"));
  const [dateFilter, setDateFilter] = useState(() => {
    const queryDate = searchParams.get("date");
    return isDateParam(queryDate) ? queryDate : "";
  });
  const [calendarMonth, setCalendarMonth] = useState(() => {
    const queryMonth = searchParams.get("month");
    const queryDate = searchParams.get("date");
    if (isMonthParam(queryMonth)) return queryMonth;
    if (isDateParam(queryDate)) return getMonthKey(queryDate);
    return getMonthKey();
  });
  const [selectedMatchId, setSelectedMatchId] = useState(null);
  const [selectedRecruitingPostId, setSelectedRecruitingPostId] = useState(null);
  const [selectedMatchDetailLoadingId, setSelectedMatchDetailLoadingId] = useState(null);
  const [selectedMatchDetailFailedId, setSelectedMatchDetailFailedId] = useState(null);
  const [selectedRecruitingPostDetailLoadingId, setSelectedRecruitingPostDetailLoadingId] = useState(null);
  const [selectedRecruitingPostDetailFailedId, setSelectedRecruitingPostDetailFailedId] = useState(null);
  const [attendanceScanState, setAttendanceScanState] = useState(null);
  const queryMatchId = searchParams.get("match");
  const attendanceQrToken = String(searchParams.get("attendanceQr") || "").trim();
  const attendanceQrFlow = Boolean(attendanceQrToken || attendanceScanState);
  const activeSelectedMatchId = selectedMatchId ?? queryMatchId;
  const todayValue = getLocalDateInputValue();
  const maxScheduleDate = addDateDays(todayValue, 365);
  const selectedView = VIEWS.find((view) => view.id === viewId) ?? VIEWS[0];
  const teamById = useMemo(() => Object.fromEntries(app.state.teams.map((team) => [team.id, team])), [app.state.teams]);
  const userById = useMemo(() => Object.fromEntries(app.state.users.map((user) => [user.id, user])), [app.state.users]);
  const matchesById = useMemo(() => Object.fromEntries(app.state.matches.map((match) => [match.id, match])), [app.state.matches]);
  const requestedMatchDetailsRef = useRef(new Set());
  const attendanceScanTokenRef = useRef("");
  const loadMatchDetail = app.actions.loadMatchDetail;
  const loadMatchRecruitingSchedule = app.actions.loadMatchRecruitingSchedule;
  const loadMatchTeamSchedule = app.actions.loadMatchTeamSchedule;
  const scheduleLoadRequestedRef = useRef(new Set());
  const lastScheduleRefreshAtRef = useRef(0);
  const registeredCourts = useMemo(() => getRegisteredCourts(app.state), [app.state]);
  const courtById = useMemo(() => Object.fromEntries(registeredCourts.map((court) => [court.id, court])), [registeredCourts]);
  const courtByName = useMemo(() => Object.fromEntries(registeredCourts.map((court) => [court.name, court])), [registeredCourts]);
  const myTeamIds = useMemo(
    () => app.state.teams
      .filter((team) => team.members.some((member) => member.userId === app.currentUser.id))
      .map((team) => team.id),
    [app.currentUser.id, app.state.teams],
  );
  const captainTeamIds = useMemo(
    () => app.state.teams
      .filter((team) => team.members.some((member) => member.userId === app.currentUser.id && member.role === "captain"))
      .map((team) => team.id),
    [app.currentUser.id, app.state.teams],
  );
  const blockedUserIds = app.state.settings?.blockedUserIds ?? [];
  const activeTournaments = useMemo(() => {
    return [...(app.state.tournaments ?? [])]
      .filter((tournament) => tournament.visibility === "private")
      .filter((tournament) => !blockedUserIds.includes(tournament.createdBy))
      .filter((tournament) => !["closed", "cancelled"].includes(tournament.status))
      .filter((tournament) => tournament.status !== "draft" || !tournament.endDate || tournament.endDate >= todayValue)
      .filter((tournament) => tournament.createdBy === app.currentUser.id || getTournamentTeamIds(tournament).some((teamId) => myTeamIds.includes(teamId)))
      .sort((a, b) => String(b.createdAt ?? "").localeCompare(String(a.createdAt ?? "")));
  }, [app.currentUser.id, app.state.tournaments, blockedUserIds, myTeamIds, todayValue]);
  const selectedRecruitingPost = useMemo(
    () => (app.state.recruitingPosts ?? []).find((post) => post.id === selectedRecruitingPostId) ?? null,
    [app.state.recruitingPosts, selectedRecruitingPostId],
  );
  const selectedRecruitingLobby = selectedRecruitingPost ? getRecruitingLobby(selectedRecruitingPost, app.state) : null;
  const selectedRecruitingPostNeedsDetail = Boolean(selectedRecruitingPost?.listCardOnly);
  const selectedRecruitingPostDetailFailed = Boolean(
    selectedRecruitingPostId && selectedRecruitingPostDetailFailedId === selectedRecruitingPostId && (!selectedRecruitingPost || selectedRecruitingPostNeedsDetail),
  );
  const selectedRecruitingPostDetailLoading = Boolean(
    selectedRecruitingPostId && !selectedRecruitingPostDetailFailed && (selectedRecruitingPostDetailLoadingId === selectedRecruitingPostId || selectedRecruitingPostNeedsDetail),
  );
  const selectedMatch = (selectedMatchId ? matchesById[selectedMatchId] : null) ?? (queryMatchId ? matchesById[queryMatchId] : null) ?? null;
  const selectedMatchRoom = useSelectedMatchRoom(selectedMatch, app.state);
  const selectedMatchRoomPost = selectedMatchRoom.post;
  const selectedMatchRoomError = selectedMatchRoom.error;
  const selectedMatchDetailLoading = Boolean(activeSelectedMatchId && selectedMatchDetailLoadingId === activeSelectedMatchId);
  const selectedMatchDetailFailed = Boolean(activeSelectedMatchId && selectedMatchDetailFailedId === activeSelectedMatchId && !selectedMatch);
  useEffect(() => {
    if (!activeSelectedMatchId || !selectedMatch || attendanceQrToken || attendanceScanState || !isMatchInPlayMenu(selectedMatch)) return;
    navigate(`/app/recorder?match=${encodeURIComponent(activeSelectedMatchId)}`, { replace: true });
  }, [activeSelectedMatchId, attendanceQrToken, attendanceScanState, navigate, selectedMatch]);
  const applyFilterState = (patch, options = {}) => {
    const nextPanelMode = patch.panelMode ?? panelMode;
    const nextViewId = patch.viewId ?? viewId;
    const nextBranchFilter = patch.branchFilter ?? branchFilter;
    const nextRelationFilter = patch.relationFilter ?? relationFilter;
    const nextDateFilter = patch.dateFilter ?? dateFilter;
    const nextCalendarMonth = patch.calendarMonth ?? calendarMonth;

    setPanelMode(nextPanelMode);
    setViewId(nextViewId);
    setBranchFilter(nextBranchFilter);
    setRelationFilter(nextRelationFilter);
    setDateFilter(nextDateFilter);
    setCalendarMonth(nextCalendarMonth);

    const next = new URLSearchParams(searchParams);
    nextPanelMode === "schedule" ? next.delete("panel") : next.set("panel", nextPanelMode);
    nextViewId === "active" ? next.delete("view") : next.set("view", nextViewId);
    nextBranchFilter === "all" ? next.delete("branch") : next.set("branch", nextBranchFilter);
    nextRelationFilter === "all" ? next.delete("relation") : next.set("relation", nextRelationFilter);
    nextDateFilter ? next.set("date", nextDateFilter) : next.delete("date");
    nextCalendarMonth === getMonthKey() ? next.delete("month") : next.set("month", nextCalendarMonth);
    setSearchParams(next, { replace: options.replace === true });
  };
  useEffect(() => {
    const nextPanelMode = getSearchParamValue(searchParams, "panel", PANEL_MODES, "schedule");
    const nextViewId = getSearchParamValue(searchParams, "view", VIEW_IDS, "active");
    const nextBranchFilter = getSearchParamValue(searchParams, "branch", BRANCH_FILTER_IDS, "all");
    const nextRelationFilter = getSearchParamValue(searchParams, "relation", RELATION_FILTER_IDS, "all");
    const queryDate = searchParams.get("date");
    const queryMonth = searchParams.get("month");
    const nextDateFilter = isDateParam(queryDate) ? queryDate : "";
    const nextCalendarMonth = isMonthParam(queryMonth) ? queryMonth : nextDateFilter ? getMonthKey(nextDateFilter) : getMonthKey();

    setPanelMode((current) => current === nextPanelMode ? current : nextPanelMode);
    setViewId((current) => current === nextViewId ? current : nextViewId);
    setBranchFilter((current) => current === nextBranchFilter ? current : nextBranchFilter);
    setRelationFilter((current) => current === nextRelationFilter ? current : nextRelationFilter);
    setDateFilter((current) => current === nextDateFilter ? current : nextDateFilter);
    setCalendarMonth((current) => current === nextCalendarMonth ? current : nextCalendarMonth);
  }, [searchParams]);
  useBodyScrollLock(Boolean(attendanceQrFlow || selectedMatch || selectedRecruitingPost || selectedMatchDetailLoading || selectedMatchDetailFailed || selectedRecruitingPostDetailLoading));
  const closeSelectedMatch = () => {
    if (activeSelectedMatchId) requestedMatchDetailsRef.current.delete(activeSelectedMatchId);
    attendanceScanTokenRef.current = "";
    setAttendanceScanState(null);
    setSelectedMatchId(null);
    setSelectedMatchDetailLoadingId(null);
    setSelectedMatchDetailFailedId(null);
    if (!queryMatchId && !attendanceQrToken) return;
    if (typeof location.state?.matchModalReturnTo === "string" && location.state.matchModalReturnTo.startsWith("/app/")) {
      if (Number(window.history.state?.idx ?? 0) > 0) {
        navigate(-1);
      } else {
        navigate(location.state.matchModalReturnTo, { replace: true });
      }
      return;
    }
    if (location.state?.matchModalFromList) {
      navigate(-1);
      return;
    }
    const next = new URLSearchParams(searchParams);
    next.delete("match");
    next.delete("attendanceQr");
    setSearchParams(next, { replace: true });
  };
  const requestMatchDetail = (matchId) => {
    if (!matchId || app.remoteReady === false || !app.currentUser.id || requestedMatchDetailsRef.current.has(matchId)) return;
    setSelectedMatchDetailFailedId((currentId) => currentId === matchId ? null : currentId);
    setSelectedMatchDetailLoadingId(matchId);
    requestMatchDetailOnce({
      matchId,
      requestedMatchDetails: requestedMatchDetailsRef.current,
      loadMatchDetail: app.actions.loadMatchDetail,
      onUnavailable: () => {
        setSelectedMatchDetailFailedId(matchId);
        app.actions.loadMoreMatches?.({ force: true });
      },
      onSettled: () => {
        setSelectedMatchDetailLoadingId((currentId) => currentId === matchId ? null : currentId);
      },
    });
  };
  const openSelectedRecruitingPost = (postId) => {
    if (!postId) return;
    setSelectedRecruitingPostDetailFailedId(null);
    setSelectedRecruitingPostDetailLoadingId(postId);
    setSelectedRecruitingPostId(postId);
  };
  useEffect(() => {
    if (!queryMatchId) {
      setSelectedMatchId((currentId) => {
        if (currentId) requestedMatchDetailsRef.current.delete(currentId);
        return null;
      });
      setSelectedMatchDetailLoadingId(null);
      setSelectedMatchDetailFailedId(null);
      return;
    }
    setSelectedMatchId(queryMatchId);
    requestMatchDetail(queryMatchId);
  }, [app.actions, app.currentUser.id, app.remoteReady, queryMatchId]);

  useMatchAttendanceQrScan({
    attendanceQrToken,
    attendanceScanTokenRef,
    currentUserId: app.currentUser.id,
    loadMatchDetail,
    queryMatchId,
    setAttendanceScanState,
    setSearchParams,
  });

  useEffect(() => {
    if (!selectedRecruitingPostId || !app.remoteReady || !app.currentUser.id) return undefined;
    const explicitDetailReload = selectedRecruitingPostDetailLoadingId === selectedRecruitingPostId;
    if (!explicitDetailReload && (app.state.recruitingPosts ?? []).some((post) => post.id === selectedRecruitingPostId && post.listCardOnly !== true)) {
      setSelectedRecruitingPostDetailLoadingId((currentId) => currentId === selectedRecruitingPostId ? null : currentId);
      setSelectedRecruitingPostDetailFailedId((currentId) => currentId === selectedRecruitingPostId ? null : currentId);
      return undefined;
    }
    if (selectedRecruitingPostDetailFailed) return undefined;
    setSelectedRecruitingPostDetailLoadingId(selectedRecruitingPostId);
    Promise.resolve(app.actions.loadRecruitingPost?.(selectedRecruitingPostId)).then((count) => {
      if (!count) setSelectedRecruitingPostDetailFailedId(selectedRecruitingPostId);
    }).finally(() => {
      setSelectedRecruitingPostDetailLoadingId((currentId) => currentId === selectedRecruitingPostId ? null : currentId);
    });
    return undefined;
  }, [app.actions.loadRecruitingPost, app.currentUser.id, app.remoteReady, app.state.recruitingPosts, selectedRecruitingPostDetailLoadingId, selectedRecruitingPostId]);

  const openSelectedMatch = (matchId) => {
    if (!matchId) return;
    requestMatchDetail(matchId);
    setSelectedMatchId(matchId);
    const next = new URLSearchParams(searchParams);
    next.set("match", matchId);
    setSearchParams(next, { state: { ...(location.state ?? {}), matchModalFromList: true } });
  };

  const matchPagination = app.matchPagination ?? {
    loading: false,
    exhausted: true,
    error: "",
  };
  const personalMatchList = getMatchListScope(app.matchLists, MATCH_LIST_SCOPES.PERSONAL);
  const teamMatchList = getMatchListScope(app.matchLists, MATCH_LIST_SCOPES.TEAM);
  const authoritativePersonalMatches = useMemo(
    () => selectMatchListMatches(matchesById, app.matchLists, MATCH_LIST_SCOPES.PERSONAL),
    [app.matchLists, matchesById],
  );
  const authoritativeTeamMatches = useMemo(
    () => selectMatchListMatches(matchesById, app.matchLists, MATCH_LIST_SCOPES.TEAM),
    [app.matchLists, matchesById],
  );
  const personalBaseFilteredMatches = useMemo(() => {
    return [...authoritativePersonalMatches]
      .filter((match) => Boolean(getMatchScheduleRelation(match, app.currentUser.id, captainTeamIds, myTeamIds)))
      .filter((match) => {
        if (match.status === "cancelled") return true;
        const matchDate = getMatchDate(match);
        if (!matchDate) return !dateFilter;
        if (matchDate > maxScheduleDate) return false;
        return shouldIncludeScheduleWindow(match, todayValue, maxScheduleDate);
      })
      .filter((match) => matchesScheduleBranch(match, "match", branchFilter))
      .filter((match) => matchesScheduleRelation(
        getMatchScheduleRelation(match, app.currentUser.id, captainTeamIds, myTeamIds),
        relationFilter,
      ));
  }, [app.currentUser.id, authoritativePersonalMatches, branchFilter, captainTeamIds, dateFilter, maxScheduleDate, myTeamIds, relationFilter, todayValue]);

  const teamBaseFilteredMatches = useMemo(() => {
    return [...authoritativeTeamMatches]
      .filter((match) => getMatchTeamScheduleRelation(match, myTeamIds) === "team")
      .filter((match) => hasAssignedTeamSchedule(match))
      .filter((match) => {
        const matchDate = getMatchDate(match);
        if (matchDate > maxScheduleDate) return false;
        return shouldIncludeScheduleWindow(match, todayValue, maxScheduleDate);
      })
      .filter((match) => matchesScheduleBranch(match, "match", "team"));
  }, [authoritativeTeamMatches, maxScheduleDate, myTeamIds, todayValue]);

  const baseFilteredMatches = panelMode === "team" ? teamBaseFilteredMatches : personalBaseFilteredMatches;

  const filteredMatches = useMemo(() => {
    return baseFilteredMatches.filter((match) => !dateFilter || getMatchDate(match) === dateFilter);
  }, [baseFilteredMatches, dateFilter]);
  const personalFilteredMatches = useMemo(() => {
    return personalBaseFilteredMatches.filter((match) => !dateFilter || getMatchDate(match) === dateFilter);
  }, [dateFilter, personalBaseFilteredMatches]);

  const refreshScheduleFromServer = useCallback(async ({ force = false } = {}) => {
    if (!app.remoteReady || !app.currentUser.id) return false;
    const now = Date.now();
    if (!force && now - lastScheduleRefreshAtRef.current < REMOTE_LIST_REFRESH_MIN_INTERVAL_MS) return false;

    const requests = [];
    if (typeof loadMatchRecruitingSchedule === "function") {
      requests.push(loadMatchRecruitingSchedule({ force: true }));
    }
    if (panelMode === "team" && typeof loadMatchTeamSchedule === "function") {
      requests.push(loadMatchTeamSchedule({ force: true }));
    }
    if (!requests.length) return false;

    lastScheduleRefreshAtRef.current = now;
    try {
      const results = await Promise.all(requests);
      if (results.some((result) => result === false)) {
        lastScheduleRefreshAtRef.current = 0;
        return false;
      }
      return true;
    } catch {
      lastScheduleRefreshAtRef.current = 0;
      return false;
    }
  }, [app.currentUser.id, app.remoteReady, loadMatchRecruitingSchedule, loadMatchTeamSchedule, panelMode]);

  useEffect(() => {
    scheduleLoadRequestedRef.current = new Set();
    lastScheduleRefreshAtRef.current = 0;
  }, [app.currentUser.id]);

  useEffect(() => {
    if (!app.remoteReady || !app.currentUser.id) return;
    const requestKey = `${app.currentUser.id}:${panelMode}`;
    if (scheduleLoadRequestedRef.current.has(requestKey)) return;
    scheduleLoadRequestedRef.current.add(requestKey);
    void refreshScheduleFromServer({ force: true });
  }, [app.currentUser.id, app.remoteReady, panelMode, refreshScheduleFromServer]);

  useEffect(() => {
    if (!app.remoteReady || !app.currentUser.id) return undefined;
    const refreshWhenVisible = () => {
      if (document.visibilityState !== "visible") return;
      void refreshScheduleFromServer();
    };
    window.addEventListener("focus", refreshWhenVisible);
    document.addEventListener("visibilitychange", refreshWhenVisible);
    return () => {
      window.removeEventListener("focus", refreshWhenVisible);
      document.removeEventListener("visibilitychange", refreshWhenVisible);
    };
  }, [app.currentUser.id, app.remoteReady, refreshScheduleFromServer]);

  const matchPageRecruitingPosts = useMemo(() => {
    const scheduleIds = new Set(personalMatchList.recruitingPostIds);
    if (!scheduleIds.size) return [];
    return (app.state.recruitingPosts ?? []).filter((post) => scheduleIds.has(post.id));
  }, [app.state.recruitingPosts, personalMatchList.recruitingPostIds]);

  const calendarMatches = useMemo(() => {
    const recruitingRooms = [...matchPageRecruitingPosts]
      .filter((post) => getRecruitingRoomsForView([post], selectedView, app.currentUser.id).length > 0)
      .filter((post) => isRecruitingScheduleRelatedToUser(post, app.state, app.currentUser.id, myTeamIds))
      .filter((post) => {
        if (getRecruitingPostTerminalState(post)) return true;
        if (isInstantScheduleRoom(post)) return false;
        const postDate = getMatchDate(post);
        if (!postDate) return false;
        return postDate <= maxScheduleDate && shouldIncludeScheduleWindow(post, todayValue, maxScheduleDate);
      })
      .filter((post) => matchesScheduleBranch(post, "room", branchFilter))
      .filter((post) => matchesScheduleRelation(getRecruitingScheduleRelation(post, app.state, app.currentUser.id, myTeamIds), relationFilter));
    return getScheduleItemsForView(baseFilteredMatches, panelMode === "team" ? [] : recruitingRooms, selectedView, app.currentUser.id, true)
      .map(({ item }) => item)
      .filter((item) => getMatchDate(item));
  }, [app.currentUser.id, app.state, baseFilteredMatches, branchFilter, matchPageRecruitingPosts, maxScheduleDate, myTeamIds, panelMode, relationFilter, selectedView, todayValue]);

  const calendarCounts = useMemo(() => {
    return calendarMatches.reduce((map, match) => {
      const date = getMatchDate(match);
      map.set(date, (map.get(date) ?? 0) + 1);
      return map;
    }, new Map());
  }, [calendarMatches]);

  const calendarDays = useMemo(() => getCalendarDays(calendarMonth), [calendarMonth]);
  const calendarMonthCount = calendarDays.reduce((sum, day) => sum + (calendarCounts.get(day) ?? 0), 0);
  const visibleRecruitingCandidates = useMemo(() => {
    return [...matchPageRecruitingPosts]
      .filter((post) => post.status === "open" || Boolean(getRecruitingPostTerminalState(post)))
      .filter((post) => getRecruitingPostTerminalState(post) || !isExpiredInstantScheduleRoom(post))
      .filter((post) => isRecruitingScheduleRelatedToUser(post, app.state, app.currentUser.id, myTeamIds))
      .filter((post) => {
        if (getRecruitingPostTerminalState(post)) return true;
        if (isInstantScheduleRoom(post)) return true;
        const postDate = getMatchDate(post);
        return postDate && postDate <= maxScheduleDate && shouldIncludeScheduleWindow(post, todayValue, maxScheduleDate);
      })
      .filter((post) => matchesScheduleBranch(post, "room", branchFilter))
      .filter((post) => matchesScheduleRelation(getRecruitingScheduleRelation(post, app.state, app.currentUser.id, myTeamIds), relationFilter));
  }, [app.currentUser.id, app.state, branchFilter, matchPageRecruitingPosts, maxScheduleDate, myTeamIds, relationFilter, todayValue]);
  const dateScopedRecruitingCandidates = useMemo(
    () => visibleRecruitingCandidates.filter((post) => matchesRecruitingScheduleDate(post, dateFilter)),
    [dateFilter, visibleRecruitingCandidates],
  );

  const hasDateFilter = Boolean(dateFilter);
  const personalScheduleItemsByView = useMemo(() => Object.fromEntries(
    VIEWS.map((view) => [
      view.id,
      getScheduleItemsForView(personalFilteredMatches, dateScopedRecruitingCandidates, view, app.currentUser.id, hasDateFilter),
    ]),
  ), [app.currentUser.id, dateScopedRecruitingCandidates, hasDateFilter, personalFilteredMatches]);
  const scheduleItemsByView = useMemo(() => {
    if (panelMode !== "team") return personalScheduleItemsByView;
    return Object.fromEntries(
      VIEWS.map((view) => [
        view.id,
        getScheduleItemsForView(filteredMatches, [], view, app.currentUser.id, hasDateFilter),
      ]),
    );
  }, [app.currentUser.id, filteredMatches, hasDateFilter, panelMode, personalScheduleItemsByView]);
  const visibleScheduleItems = scheduleItemsByView[viewId] ?? [];
  const viewButtonCounts = Object.fromEntries(
    VIEWS.map((view) => [view.id, personalScheduleItemsByView[view.id]?.length ?? 0]),
  );
  const activeCount = viewButtonCounts.active ?? 0;
  const todoCount = viewButtonCounts.todo ?? 0;
  const scheduledCount = viewButtonCounts.scheduled ?? 0;
  const getViewButtonCount = (view) => viewButtonCounts[view.id] ?? 0;
  const activeMatchList = panelMode === "team" ? teamMatchList : personalMatchList;
  const personalScheduleLoading = app.remoteReady === false || isMatchListInitialLoading(personalMatchList);
  const scheduleLoading = app.remoteReady === false || isMatchListInitialLoading(activeMatchList);
  const scheduleError = activeMatchList.error;
  const displayScheduleItems = scheduleLoading ? [] : visibleScheduleItems;
  const scheduleCountLabel = scheduleLoading
    ? `${panelMode === "team" ? "내 팀 일정" : "내 일정"} 확인 중`
    : `${panelMode === "team" ? "내 팀 일정" : "내 일정"} ${visibleScheduleItems.length}개 중 ${displayScheduleItems.length}개 표시`;
  const displayActiveCount = personalScheduleLoading ? "..." : activeCount;
  const displayTodoCount = personalScheduleLoading ? "..." : todoCount;
  const displayScheduledCount = personalScheduleLoading ? "..." : scheduledCount;
  const getDisplayViewButtonCount = (view) => (personalScheduleLoading ? "..." : getViewButtonCount(view));
  const teamScheduleCount = useMemo(() => {
    if (teamMatchList.status === MATCH_LIST_STATUSES.IDLE) return "";
    return getScheduleItemsForView(teamBaseFilteredMatches, [], VIEWS[0], app.currentUser.id, false).length;
  }, [app.currentUser.id, teamBaseFilteredMatches, teamMatchList.status]);
  return { app, location, viewId, panelMode, branchFilter, relationFilter, dateFilter, calendarMonth, selectedRecruitingPostId, setSelectedRecruitingPostId, setSelectedRecruitingPostDetailLoadingId, setSelectedRecruitingPostDetailFailedId, attendanceScanState, attendanceQrFlow, activeSelectedMatchId, todayValue, selectedView, teamById, userById, matchesById, courtById, courtByName, activeTournaments, selectedRecruitingPost, selectedRecruitingLobby, selectedRecruitingPostDetailFailed, selectedRecruitingPostDetailLoading, selectedMatch, selectedMatchRoomPost, selectedMatchRoomError, selectedMatchDetailLoading, selectedMatchDetailFailed, applyFilterState, closeSelectedMatch, requestMatchDetail, openSelectedRecruitingPost, openSelectedMatch, matchPagination, teamMatchList, calendarCounts, calendarDays, calendarMonthCount, scheduleLoading, scheduleError, displayScheduleItems, scheduleCountLabel, displayActiveCount, displayTodoCount, displayScheduledCount, getDisplayViewButtonCount, teamScheduleCount };
}
