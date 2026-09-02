import { REPORT_TARGET_TYPES } from "../lib/reportReasons.js";
import { getCourtHashtag, getMatchHashtag, getTeamHashtag, getUserHashtag } from "../lib/handles.js";
import { getReportParticipantRows, getMatchReportTitle, matchesReportSearchQuery } from "./settingsPageModel.js";

export function buildReportTargetSearchItems({
  currentUserId,
  matchMap,
  reportReason,
  reportTargetQuery,
  reportTargetType,
  reportableCourtRequests,
  reportableCourtReviews,
  reportableCourts,
  reportableMatchCandidates,
  reportableTeams,
  userMap,
}) {
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
        if (row.userId === currentUserId) return;
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
}

export function getReportRemoteSearchTypes(reportTargetType, reportNeedsMatchData) {
  if (reportTargetType === REPORT_TARGET_TYPES.courtReview) return ["court_review"];
  if (reportTargetType === REPORT_TARGET_TYPES.teamName || reportTargetType === REPORT_TARGET_TYPES.teamEmblem) return ["team"];
  if (reportTargetType === REPORT_TARGET_TYPES.courtRequest) return ["court_request"];
  if (reportTargetType === REPORT_TARGET_TYPES.court) return ["court"];
  if (reportTargetType === REPORT_TARGET_TYPES.mixed) return ["court", "court_review", "match_code"];
  return reportNeedsMatchData ? ["match_code"] : [];
}

export function mapReportRemoteTarget(item, {
  currentUserId,
  matchMap,
  reportableMatchCandidates,
  userMap,
}) {
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
    if (item.members?.some((member) => member.role === "captain" && member.userId === currentUserId)) return null;
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
}
