import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocation } from "react-router-dom";
import { REPORT_TARGET_TYPES, VOID_MATCH_RESTORE_REPORT_REASON, getCourtCorrectionFieldForReportReason, getReportReasonValue, getReportTargetType } from "../lib/reportReasons.js";
import { canRequestVoidMatchRestore, getReportableMatchTimeMs } from "../lib/matchUtils.js";
import { REPORT_MATCH_WINDOW_MS } from "../lib/constants.js";
import { getCourtHashtag, getMatchHashtag, getTeamHashtag, getUserHashtag } from "../lib/handles.js";
import { DIRECTORY_SELF_PAGE_LIMIT } from "../lib/queryPolicy.js";
import { isSupabaseConfigured } from "../lib/supabase.js";
import { isReportTargetCompatible, parseReportEntry } from "../lib/reportEntry.js";
import { getReportParticipantRows, getMatchReportTitle, matchesReportSearchQuery } from "./settingsPageModel.js";

export default function useSettingsReportController({ app, userMap, matchMap, courtRequests, approvedCourts, courtReviews }) {
const location = useLocation();
const reportEntry = useMemo(() => parseReportEntry(location.search), [location.search]);
const loadDirectory = app.actions.loadDirectory;
const [reportMatchId, setReportMatchId] = useState("");
const [reportReason, setReportReason] = useState("");
const [reportTargetQuery, setReportTargetQuery] = useState("");
const [reportCourtRequestId, setReportCourtRequestId] = useState("");
const [reportCourtId, setReportCourtId] = useState("");
const [reportCourtReviewId, setReportCourtReviewId] = useState("");
const [reportTeamId, setReportTeamId] = useState("");
const [reportRemoteTarget, setReportRemoteTarget] = useState(null);
const [reportMemo, setReportMemo] = useState("");
const [reportedUserIds, setReportedUserIds] = useState([]);
const [reportSubmitPending, setReportSubmitPending] = useState(false);
const reportSubmitPendingRef = useRef(false);
const [reportSubmitStatus, setReportSubmitStatus] = useState("");
const [reportReceipt, setReportReceipt] = useState(null);
const [reportMatchesLoading, setReportMatchesLoading] = useState(false);
const [reportMatchesError, setReportMatchesError] = useState("");
const reportMatchesLoadRef = useRef("");
const initializedEntryRef = useRef("");
const recentReportMatches = useMemo(() => {
    const now = Date.now();
    const cutoff = now - REPORT_MATCH_WINDOW_MS;
    return [...app.state.matches]
      .map((match) => ({ match, reportTime: getReportableMatchTimeMs(match) }))
      .filter(({ match, reportTime }) => (
        reportTime >= cutoff &&
        reportTime <= now &&
        getReportParticipantRows(match, userMap).some((row) => row.userId === app.currentUserId)
      ))
      .sort((a, b) => b.reportTime - a.reportTime)
      .map(({ match }) => match);
  }, [app.currentUserId, app.state.matches, userMap]);
const reportTargetType = reportReason ? getReportTargetType(reportReason) : "";
const isVoidRestoreReport = reportReason === VOID_MATCH_RESTORE_REPORT_REASON;
const reportableMatchCandidates = useMemo(
    () => (isVoidRestoreReport
      ? recentReportMatches.filter((match) => canRequestVoidMatchRestore(match, app.currentUserId))
      : recentReportMatches),
    [app.currentUserId, isVoidRestoreReport, recentReportMatches],
  );
const reportNeedsMatchData = [REPORT_TARGET_TYPES.player, REPORT_TARGET_TYPES.match, REPORT_TARGET_TYPES.mixed].includes(reportTargetType);
const requestReportableMatches = useCallback(async () => {
    const loadReportableMatches = app.actions.loadReportableMatches;
    if (!app.currentUserId || !loadReportableMatches) return false;
    reportMatchesLoadRef.current = app.currentUserId;
    setReportMatchesLoading(true);
    setReportMatchesError("");
    try {
      const ok = await loadReportableMatches();
      if (ok !== false) return true;
      reportMatchesLoadRef.current = "";
      setReportMatchesError("신고 가능한 경기를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.");
      return false;
    } catch {
      reportMatchesLoadRef.current = "";
      setReportMatchesError("신고 가능한 경기를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.");
      return false;
    } finally {
      setReportMatchesLoading(false);
    }
  }, [app.actions.loadReportableMatches, app.currentUserId]);
useEffect(() => {
    if (!isSupabaseConfigured) return;
    if (!reportNeedsMatchData || !app.currentUserId || reportMatchesLoadRef.current === app.currentUserId) return;
    void requestReportableMatches();
  }, [app.currentUserId, reportNeedsMatchData, requestReportableMatches]);
const retryReportMatches = useCallback(() => { reportMatchesLoadRef.current = ""; return requestReportableMatches(); }, [requestReportableMatches]);
const reportableCourtRequests = useMemo(() => (
    courtRequests.filter((request) => {
      const alreadyReported = app.state.reports?.some((report) => (
        report.type === "court_request" &&
        report.targetId === request.id &&
        report.by === app.currentUserId &&
        report.status !== "dismissed"
      ));
      return request.requestedBy !== app.currentUserId
        && ["pending", "reported"].includes(request.status ?? "pending")
        && !alreadyReported;
    })
  ), [app.currentUserId, app.state.reports, courtRequests]);
const reportableCourts = useMemo(() => (
    approvedCourts.filter((court) => {
      const alreadyReported = app.state.reports?.some((report) => (
        report.type === "court" &&
        report.targetId === court.id &&
        report.by === app.currentUserId &&
        report.status !== "dismissed" &&
        report.status !== "resolved"
      ));
      return court.id && (!court.status || court.status === "active") && !alreadyReported;
    })
  ), [app.currentUserId, app.state.reports, approvedCourts]);
const reportableCourtReviews = useMemo(() => (
    courtReviews.filter((review) => {
      const alreadyReported = app.state.reports?.some((report) => (
        report.type === "court_review" &&
        report.targetId === review.id &&
        report.by === app.currentUserId &&
        report.status !== "dismissed" &&
        report.status !== "resolved"
      ));
      return review.id && (!review.status || review.status === "active") && review.reviewerId !== app.currentUserId && !alreadyReported;
    })
  ), [app.currentUserId, app.state.reports, courtReviews]);
const reportableTeams = useMemo(() => (
    (app.state.teams ?? []).filter((team) => (
      team.id && !team.members?.some((member) => member.role === "captain" && member.userId === app.currentUserId)
    ))
  ), [app.currentUserId, app.state.teams]);
const selectedReportMatchId = reportableMatchCandidates.some((match) => match.id === reportMatchId) ? reportMatchId : "";
const selectedReportMatch = reportableMatchCandidates.find((match) => match.id === selectedReportMatchId) ?? null;
const selectedReportCourtRequest = reportableCourtRequests.find((request) => request.id === reportCourtRequestId)
    ?? (reportRemoteTarget?.kind === "court_request" && reportRemoteTarget.request?.id === reportCourtRequestId ? reportRemoteTarget.request : null);
const selectedReportCourt = reportableCourts.find((court) => court.id === reportCourtId)
    ?? (reportRemoteTarget?.kind === "court" && reportRemoteTarget.court?.id === reportCourtId ? reportRemoteTarget.court : null);
const selectedReportCourtReview = reportableCourtReviews.find((review) => review.id === reportCourtReviewId)
    ?? (reportRemoteTarget?.kind === "court_review" && reportRemoteTarget.review?.id === reportCourtReviewId ? reportRemoteTarget.review : null);
const selectedReportTeam = reportableTeams.find((team) => team.id === reportTeamId)
    ?? (reportRemoteTarget?.kind === "team" && reportRemoteTarget.team?.id === reportTeamId ? reportRemoteTarget.team : null);
const selectedTeamHasUploadedEmblem = selectedReportTeam?.emblemSource === "upload" && Boolean(selectedReportTeam?.emblemKey);
const reportParticipantRows = useMemo(
    () => (selectedReportMatch && reportTargetType !== REPORT_TARGET_TYPES.courtRequest
      ? getReportParticipantRows(selectedReportMatch, userMap).filter((row) => reportTargetType !== REPORT_TARGET_TYPES.player || row.userId !== app.currentUserId)
      : []),
    [app.currentUserId, reportTargetType, selectedReportMatch, userMap],
  );
const reportParticipantIds = useMemo(
    () => reportParticipantRows.map((row) => row.userId),
    [reportParticipantRows],
  );
const selectedReportedUserIds = reportedUserIds.filter((userId) => reportParticipantIds.includes(userId));
useEffect(() => {
    const entryKey = `${location.pathname}${location.search}`;
    if (!reportEntry.focus || initializedEntryRef.current === entryKey) return;
    if (reportEntry.targetType === REPORT_TARGET_TYPES.match) {
      const match = reportableMatchCandidates.find((candidate) => candidate.id === reportEntry.targetId);
      if (!match) return;
      setReportMatchId(match.id);
      setReportTargetQuery(`${getMatchReportTitle(match)} ${getMatchHashtag(match)}`.trim());
      initializedEntryRef.current = entryKey;
      return;
    }
    if (reportEntry.targetType === REPORT_TARGET_TYPES.player) {
      const match = reportableMatchCandidates.find((candidate) => candidate.id === reportEntry.sourceMatchId);
      const row = match ? getReportParticipantRows(match, userMap).find((candidate) => candidate.userId === reportEntry.targetId) : null;
      if (!match || !row || row.userId === app.currentUserId) return;
      setReportMatchId(match.id);
      setReportedUserIds([row.userId]);
      setReportTargetQuery(`${row.user.name} ${getUserHashtag(row.user)} ${getMatchHashtag(match)}`.trim());
      initializedEntryRef.current = entryKey;
      return;
    }
    initializedEntryRef.current = entryKey;
  }, [app.currentUserId, location.pathname, location.search, reportEntry, reportableMatchCandidates, userMap]);
const reportTargetSearchItems = useMemo(() => {
    if (!reportReason) return [];
    const includePlayers = reportTargetType === REPORT_TARGET_TYPES.player || reportTargetType === REPORT_TARGET_TYPES.mixed;
    const includeMatches = reportTargetType === REPORT_TARGET_TYPES.match || reportTargetType === REPORT_TARGET_TYPES.mixed;
    const includeCourtRequests = reportTargetType === REPORT_TARGET_TYPES.courtRequest || reportTargetType === REPORT_TARGET_TYPES.mixed;
    const includeCourts = reportTargetType === REPORT_TARGET_TYPES.court || reportTargetType === REPORT_TARGET_TYPES.mixed;
    const includeCourtReviews = reportTargetType === REPORT_TARGET_TYPES.courtReview || reportTargetType === REPORT_TARGET_TYPES.mixed;
    const includeTeams = reportTargetType === REPORT_TARGET_TYPES.teamName || reportTargetType === REPORT_TARGET_TYPES.teamEmblem;
    const items = [];

    if (includeMatches) {
      reportableMatchCandidates.forEach((match) => {
        const hashtag = getMatchHashtag(match);
        const title = getMatchReportTitle(match);
        items.push({
          id: `match:${match.id}`,
          kind: "match",
          match,
          title,
          subtitle: `${match.scheduledDate || match.scheduledAt || "일정 미정"} · ${match.court || "구장 미정"}`,
          meta: hashtag,
          haystack: `${title} ${hashtag} ${match.teamA?.name ?? ""} ${match.teamB?.name ?? ""} ${match.court ?? ""} ${match.scheduledDate ?? ""} ${match.scheduledTime ?? ""}`.toLowerCase(),
        });
      });
    }

    if (includePlayers) {
      reportableMatchCandidates.forEach((match) => {
        const matchHashtag = getMatchHashtag(match);
        getReportParticipantRows(match, userMap).forEach((row) => {
          if (row.userId === app.currentUserId) return;
          const userHashtag = getUserHashtag(row.user);
          const matchTitle = getMatchReportTitle(match);
          items.push({
            id: `player:${match.id}:${row.userId}`,
            kind: "player",
            match,
            row,
            title: row.user.name,
            subtitle: `${row.sideLabel} · ${row.teamName} · ${row.role} · ${matchTitle}`,
            meta: `${userHashtag} · ${matchHashtag}`,
            haystack: `${row.user.name} ${userHashtag} ${row.user.position} ${row.teamName} ${row.role} ${matchTitle} ${matchHashtag} ${match.court ?? ""}`.toLowerCase(),
          });
        });
      });
    }

    if (includeCourtRequests) {
      reportableCourtRequests.forEach((request) => {
        const requester = userMap[request.requestedBy];
        const hashtag = request.hashtag ? getCourtHashtag(request) : "";
        items.push({
          id: `court-request:${request.id}`,
          kind: "court_request",
          request,
          title: request.name,
          subtitle: `${request.addressText || "주소 미정"} · ${requester?.name ?? "요청자"}`,
          meta: hashtag || "구장요청",
          haystack: `${request.name} ${request.addressText ?? ""} ${request.region ?? ""} ${requester?.name ?? ""} ${hashtag}`.toLowerCase(),
        });
      });
    }

    if (includeCourts) {
      reportableCourts.forEach((court) => {
        const hashtag = court.hashtag ? getCourtHashtag(court) : "";
        items.push({
          id: `court:${court.id}`,
          kind: "court",
          court,
          title: court.name,
          subtitle: `${court.addressText || "주소 미정"} · 등록 구장`,
          meta: hashtag || "승인 구장",
          haystack: `${court.name} ${court.addressText ?? ""} ${court.region ?? ""} ${hashtag}`.toLowerCase(),
        });
      });
    }

    if (includeCourtReviews) {
      reportableCourtReviews.forEach((review) => {
        const reviewer = userMap[review.reviewerId];
        const match = matchMap[review.matchId];
        items.push({
          id: `court-review:${review.id}`,
          kind: "court_review",
          review,
          title: review.courtName || "구장 리뷰",
          subtitle: `${review.rating ?? "-"}점 · ${reviewer?.name ?? "작성자"} · ${match?.title ?? "경기"}`,
          meta: match ? getMatchHashtag(match) : "구장 리뷰",
          haystack: `${review.courtName ?? ""} ${review.memo ?? ""} ${review.tags?.join?.(" ") ?? ""} ${reviewer?.name ?? ""} ${match?.title ?? ""}`.toLowerCase(),
        });
      });
    }

    if (includeTeams) {
      reportableTeams.forEach((team) => {
        items.push({
          id: `team:${team.id}`,
          kind: "team",
          team,
          title: team.name,
          subtitle: `${team.region || "지역 미정"} · ${team.homeCourt || "홈코트 미정"}`,
          meta: getTeamHashtag(team),
          haystack: `${team.name} ${team.region ?? ""} ${team.homeCourt ?? ""} ${getTeamHashtag(team)}`.toLowerCase(),
        });
      });
    }

    return items.filter((item) => matchesReportSearchQuery(item.haystack, reportTargetQuery));
  }, [app.currentUserId, matchMap, reportReason, reportTargetQuery, reportTargetType, reportableCourtRequests, reportableCourtReviews, reportableCourts, reportableMatchCandidates, reportableTeams, userMap]);
const reportRemoteSearchTypes = reportTargetType === REPORT_TARGET_TYPES.courtReview
    ? ["court_review"]
    : reportTargetType === REPORT_TARGET_TYPES.teamName || reportTargetType === REPORT_TARGET_TYPES.teamEmblem
      ? ["team"]
      : reportTargetType === REPORT_TARGET_TYPES.courtRequest
        ? ["court_request"]
        : reportTargetType === REPORT_TARGET_TYPES.court
          ? ["court"]
          : reportTargetType === REPORT_TARGET_TYPES.mixed
            ? ["court", "court_review", "match_code"]
            : reportNeedsMatchData
              ? ["match_code"]
              : [];
const mapRemoteReportTarget = (item) => {
    if (item?.kind === "match_code") {
      const match = reportableMatchCandidates.find((candidate) => candidate.id === item.matchId);
      if (!match) return null;
      return {
        id: `match:${match.id}`,
        kind: "match",
        match,
        title: getMatchReportTitle(match),
        subtitle: `${match.scheduledDate || match.scheduledAt || "일정 미정"} · ${match.court || "구장 미정"}`,
        meta: getMatchHashtag(match),
      };
    }
    if (item?.kind === "court_request") {
      return {
        id: `court-request:${item.id}`,
        kind: "court_request",
        request: item,
        title: item.name,
        subtitle: `${item.addressText || "주소 미정"} · 등록요청`,
        meta: item.hashtag || "구장요청",
      };
    }
    if (item?.kind === "team") {
      if (item.members?.some((member) => member.role === "captain" && member.userId === app.currentUserId)) return null;
      return {
        id: `team:${item.id}`,
        kind: "team",
        team: item,
        title: item.name,
        subtitle: `${item.region || "지역 미정"} · ${item.homeCourt || "홈코트 미정"}`,
        meta: getTeamHashtag(item),
      };
    }
    if (item?.kind === "court") {
      const hashtag = item.hashtag ? getCourtHashtag(item) : "";
      return {
        id: `court:${item.id}`,
        kind: "court",
        court: item,
        title: item.name,
        subtitle: `${item.addressText || "주소 미정"} · 등록 구장`,
        meta: hashtag || "승인 구장",
      };
    }
    if (item?.kind === "court_review") {
      return {
        id: `court-review:${item.id}`,
        kind: "court_review",
        review: item,
        title: item.courtName || "구장 리뷰",
        subtitle: `${item.rating ?? "-"}점 · ${userMap[item.reviewerId]?.name ?? "작성자"} · ${matchMap[item.matchId]?.title ?? "경기"}`,
        meta: matchMap[item.matchId] ? getMatchHashtag(matchMap[item.matchId]) : "구장 리뷰",
      };
    }
    return null;
  };
const hasValidVoidRestoreMemo = !isVoidRestoreReport || reportMemo.trim().length >= 10;
const canSubmitReport = Boolean(reportReason) && hasValidVoidRestoreMemo && (
    reportTargetType === REPORT_TARGET_TYPES.courtRequest
      ? Boolean(selectedReportCourtRequest)
      : reportTargetType === REPORT_TARGET_TYPES.court
        ? Boolean(selectedReportCourt)
        : reportTargetType === REPORT_TARGET_TYPES.courtReview
          ? Boolean(selectedReportCourtReview)
          : reportTargetType === REPORT_TARGET_TYPES.teamName
            ? Boolean(selectedReportTeam)
            : reportTargetType === REPORT_TARGET_TYPES.teamEmblem
              ? Boolean(selectedReportTeam && selectedTeamHasUploadedEmblem)
      : reportTargetType === REPORT_TARGET_TYPES.player
        ? Boolean(selectedReportMatch && selectedReportedUserIds.length)
        : Boolean(selectedReportMatch || selectedReportCourtRequest || selectedReportCourt || selectedReportCourtReview)
  );
const selectReportTarget = (item) => {
    setReportTargetQuery(`${item.title} ${item.meta ?? ""}`.trim());
    if (item.kind === "court_request") {
      setReportRemoteTarget(item);
      setReportCourtRequestId(item.request.id);
      setReportCourtId("");
      setReportCourtReviewId("");
      setReportMatchId("");
      setReportTeamId("");
      setReportedUserIds([]);
      return;
    }
    if (item.kind === "court") {
      setReportRemoteTarget(item);
      setReportCourtId(item.court.id);
      setReportCourtRequestId("");
      setReportCourtReviewId("");
      setReportMatchId("");
      setReportTeamId("");
      setReportedUserIds([]);
      return;
    }
    if (item.kind === "court_review") {
      setReportRemoteTarget(item);
      setReportCourtReviewId(item.review.id);
      setReportCourtId("");
      setReportCourtRequestId("");
      setReportMatchId("");
      setReportTeamId("");
      setReportedUserIds([]);
      return;
    }
    if (item.kind === "team") {
      setReportRemoteTarget(item);
      setReportTeamId(item.team.id);
      setReportCourtRequestId("");
      setReportCourtId("");
      setReportCourtReviewId("");
      setReportMatchId("");
      setReportedUserIds([]);
      return;
    }
    setReportCourtRequestId("");
    setReportRemoteTarget(null);
    setReportCourtId("");
    setReportCourtReviewId("");
    setReportTeamId("");
    setReportMatchId(item.match.id);
    setReportedUserIds(item.kind === "player" ? [item.row.userId] : []);
  };
const changeReportTargetQuery = (value) => {
    setReportTargetQuery(value);
    setReportMatchId("");
    setReportCourtRequestId("");
    setReportCourtId("");
    setReportCourtReviewId("");
    setReportTeamId("");
    setReportRemoteTarget(null);
    setReportedUserIds([]);
  };
const changeReportReason = (nextReason) => {
    const nextTargetType = nextReason ? getReportTargetType(nextReason) : "";
    const selectedTargetType = selectedReportedUserIds.length
      ? REPORT_TARGET_TYPES.player
      : selectedReportMatch
        ? REPORT_TARGET_TYPES.match
        : selectedReportCourtRequest
          ? REPORT_TARGET_TYPES.courtRequest
          : selectedReportCourt
            ? REPORT_TARGET_TYPES.court
            : selectedReportCourtReview
              ? REPORT_TARGET_TYPES.courtReview
              : selectedReportTeam
                ? reportTargetType
                : "";
    const compatible = !selectedTargetType
      || isReportTargetCompatible(selectedTargetType, nextTargetType)
      || selectedTargetType === nextTargetType;
    if (!compatible) {
      const confirmed = window.confirm("신고 사유를 바꾸면 선택한 대상만 초기화됩니다. 계속할까요?");
      if (!confirmed) return;
      changeReportTargetQuery("");
    }
    setReportReason(nextReason);
  };
const renderReportTargetSearchItem = (item) => (
    <button
      key={item.id}
      type="button"
      className="search-picker-result-row"
      onMouseDown={(event) => event.preventDefault()}
      onClick={() => selectReportTarget(item)}
    >
      <strong>{item.title}</strong>
      <span>{item.subtitle}</span>
      <em>{item.meta}</em>
    </button>
  );
const submitReport = async (event) => {
    event.preventDefault();
    if (!canSubmitReport || reportSubmitPendingRef.current) return;
    const memo = reportMemo.trim();
    const receiptTarget = selectedReportTeam
      ? { type: reportTargetType, id: selectedReportTeam.id }
      : selectedReportCourtRequest
        ? { type: REPORT_TARGET_TYPES.courtRequest, id: selectedReportCourtRequest.id }
        : selectedReportCourt
          ? { type: REPORT_TARGET_TYPES.court, id: selectedReportCourt.id }
          : selectedReportCourtReview
            ? { type: REPORT_TARGET_TYPES.courtReview, id: selectedReportCourtReview.id }
            : reportTargetType === REPORT_TARGET_TYPES.player
              ? { type: REPORT_TARGET_TYPES.player, id: selectedReportedUserIds[0] }
              : { type: REPORT_TARGET_TYPES.match, id: selectedReportMatchId };
    reportSubmitPendingRef.current = true;
    setReportSubmitPending(true);
    setReportSubmitStatus("신고 저장 중");
    try {
      let result = null;
      const reportReasonValue = getReportReasonValue(reportReason);
      if (selectedReportTeam && reportTargetType === REPORT_TARGET_TYPES.teamName) {
        result = await app.actions.reportTeamName(selectedReportTeam.id, [reportReasonValue, memo].filter(Boolean).join(" · "), selectedReportTeam.name);
      } else if (selectedReportTeam && reportTargetType === REPORT_TARGET_TYPES.teamEmblem) {
        result = await app.actions.reportTeamEmblem(selectedReportTeam.id, [reportReasonValue, memo].filter(Boolean).join(" · "), selectedReportTeam);
      } else if (selectedReportCourtRequest) {
        result = await app.actions.reportCourtRequest(selectedReportCourtRequest.id, [reportReason, memo].filter(Boolean).join(" · "));
      } else if (selectedReportCourt) {
        const correctionField = getCourtCorrectionFieldForReportReason(reportReason);
        result = await app.actions.reportCourt(
          selectedReportCourt.id,
          [reportReason, memo].filter(Boolean).join(" · "),
          {
            field: correctionField,
            proposedValue: memo || (correctionField === "duplicate" ? "동일 구장 중복 등록 확인 필요" : reportReason),
            evidenceUrl: "",
          },
          selectedReportCourt,
        );
      } else if (selectedReportCourtReview) {
        result = await app.actions.reportCourtReview(selectedReportCourtReview.id, [reportReason, memo].filter(Boolean).join(" · "));
      } else if (selectedReportMatchId) {
        const matchLine = selectedReportMatch ? getMatchHashtag(selectedReportMatch) : "";
        if (reportTargetType === REPORT_TARGET_TYPES.player) {
          const targetUserId = selectedReportedUserIds[0] ?? "";
          result = await app.actions.reportPlayer(targetUserId, selectedReportMatchId, [reportReason, matchLine, memo].filter(Boolean).join(" · "));
        } else {
          const targetNames = selectedReportedUserIds.map((userId) => userMap[userId]?.name).filter(Boolean);
          const targetLine = targetNames.length ? `대상: ${targetNames.join(", ")}` : "대상: 경기 기록";
          const reason = isVoidRestoreReport
            ? `${VOID_MATCH_RESTORE_REPORT_REASON}: ${memo}`
            : [reportReason, matchLine, targetLine, memo].filter(Boolean).join(" · ");
          result = await app.actions.reportMatch(selectedReportMatchId, reason, selectedReportedUserIds);
        }
      }
      if (!result || result.ok === false) {
        setReportSubmitStatus("신고를 접수하지 못했습니다. 입력 내용을 확인한 뒤 다시 시도해 주세요.");
        return;
      }
      setReportSubmitStatus(result.duplicate ? "이미 접수된 신고입니다." : "신고가 접수됐습니다.");
      setReportReceipt({
        id: result.reportId,
        status: result.status ?? "open",
        createdAt: result.createdAt,
        reason: [reportReason, memo].filter(Boolean).join(" · "),
        type: receiptTarget.type,
        targetId: receiptTarget.id,
        by: app.currentUserId,
        duplicate: result.duplicate === true,
      });
      if (loadDirectory) {
        await Promise.resolve()
          .then(() => loadDirectory({ kind: "self", limit: DIRECTORY_SELF_PAGE_LIMIT, offset: 0, force: true }))
          .catch(() => false);
      }
      setReportReason("");
      setReportMatchId("");
      setReportedUserIds([]);
      setReportCourtRequestId("");
      setReportCourtId("");
      setReportCourtReviewId("");
      setReportTeamId("");
      setReportRemoteTarget(null);
      setReportTargetQuery("");
      setReportMemo("");
    } catch {
      setReportSubmitStatus((current) => (
        current === "신고가 접수됐습니다." || current === "이미 접수된 신고입니다."
          ? current
          : "신고를 접수하지 못했습니다. 입력 내용은 유지됩니다."
      ));
    } finally {
      reportSubmitPendingRef.current = false;
      setReportSubmitPending(false);
    }
  };
const toggleReportedUser = (userId) => {
    setReportedUserIds((current) => (
      current.includes(userId)
        ? []
        : [userId]
    ));
  };
  return { reportMatchId, setReportMatchId, reportReason, setReportReason, changeReportReason, reportTargetQuery, setReportTargetQuery, reportCourtRequestId, setReportCourtRequestId, reportCourtId, setReportCourtId, reportCourtReviewId, setReportCourtReviewId, reportTeamId, setReportTeamId, reportRemoteTarget, setReportRemoteTarget, reportMemo, setReportMemo, reportedUserIds, setReportedUserIds, reportSubmitPending, setReportSubmitPending, reportSubmitStatus, setReportSubmitStatus, reportReceipt, reportMatchesLoading, setReportMatchesLoading, reportMatchesError, setReportMatchesError, retryReportMatches, recentReportMatches, reportTargetType, isVoidRestoreReport, reportableMatchCandidates, reportNeedsMatchData, reportableCourtRequests, reportableCourts, reportableCourtReviews, reportableTeams, selectedReportMatchId, selectedReportMatch, selectedReportCourtRequest, selectedReportCourt, selectedReportCourtReview, selectedReportTeam, selectedTeamHasUploadedEmblem, reportParticipantRows, reportParticipantIds, selectedReportedUserIds, reportTargetSearchItems, reportRemoteSearchTypes, mapRemoteReportTarget, hasValidVoidRestoreMemo, canSubmitReport, selectReportTarget, changeReportTargetQuery, renderReportTargetSearchItem, submitReport, toggleReportedUser };
}
