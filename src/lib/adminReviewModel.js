import { getMatchPlayerIds } from "./matchUtils.js";
import { addReport, finalizeReviewRow, getOpenCount, getTime, isRecordIssueMatch, makeMatchMap, makeUserMap, pushGrouped, sortReviewRows } from "./adminPolicy.js";

export function buildAdminReviewModel(state = {}) {
  const users = state.users ?? [];
  const teams = state.teams ?? [];
  const affiliations = state.affiliations ?? [];
  const matches = state.matches ?? [];
  const reports = state.reports ?? [];
  const courtRequests = state.settings?.courtRequests ?? [];
  const approvedCourts = state.settings?.approvedCourts ?? [];
  const courtReviews = state.settings?.courtReviews ?? [];
  const disciplinaryActions = state.settings?.adminDisciplinaryActions ?? [];
  const userMap = makeUserMap(users);
  const matchMap = makeMatchMap(matches);
  const teamById = Object.fromEntries(teams.map((team) => [team.id, team]));
  const affiliationById = Object.fromEntries(affiliations.map((affiliation) => [affiliation.id, affiliation]));
  const courtMap = new Map();
  const playerMap = new Map();
  const matchReviewMap = new Map();
  const teamReviewMap = new Map();
  const addPlayerReport = (playerId, report) => {
    const player = userMap[playerId];
    const playerRow = pushGrouped(playerMap, playerId, {
      title: player?.name ?? "알 수 없음",
      subtitle: `${player?.region ?? "지역 미정"} · ${player?.position ?? "-"} · 신뢰도 ${player?.trustScore ?? "-"}`,
      player,
    });
    addReport(playerRow, report);
  };

  matches.forEach((match) => {
    const courtName = match.court || "미정 구장";
    const courtRow = pushGrouped(courtMap, `court-name:${courtName}`, {
      title: courtName,
      subtitle: `${match.region ?? "지역 미정"} · 경기 ${matches.filter((item) => item.court === courtName).length}건`,
    });
    courtRow.matches.push(match);

    const matchRow = pushGrouped(matchReviewMap, match.id, {
      title: match.title ?? `${match.teamA?.name ?? "A"} vs ${match.teamB?.name ?? "B"}`,
      subtitle: `${match.court ?? "미정 구장"} · ${match.scheduledDate ?? ""} ${match.scheduledTime ?? ""}`.trim(),
      match,
    });
    matchRow.matches = [match];

    getMatchPlayerIds(match).forEach((playerId) => {
      const player = userMap[playerId];
      const playerRow = pushGrouped(playerMap, playerId, {
        title: player?.name ?? "알 수 없음",
        subtitle: `${player?.region ?? "지역 미정"} · ${player?.position ?? "-"} · 신뢰도 ${player?.trustScore ?? "-"}`,
        player,
      });
      playerRow.matches.push(match);
    });
  });

  courtRequests.forEach((request) => {
    const courtName = request.name || "미정 구장요청";
    const row = pushGrouped(courtMap, `court-request:${request.id}`, {
      title: courtName,
      subtitle: `${request.region ?? "지역 미정"} · 등록요청`,
    });
    row.courtRequests.push(request);

    const requesterRow = pushGrouped(playerMap, request.requestedBy, {
      title: userMap[request.requestedBy]?.name ?? "요청자",
      subtitle: `${userMap[request.requestedBy]?.region ?? "지역 미정"} · 구장 등록요청자`,
      player: userMap[request.requestedBy],
    });
    requesterRow.courtRequests.push(request);
  });

  disciplinaryActions.forEach((action) => {
    const player = userMap[action.userId];
    const playerRow = pushGrouped(playerMap, action.userId, {
      title: player?.name ?? "알 수 없음",
      subtitle: `${player?.region ?? "지역 미정"} · ${player?.position ?? "-"} · 신뢰도 ${player?.trustScore ?? "-"}`,
      player,
    });
    playerRow.disciplinaryActions.push(action);
    playerRow.latestAt = Math.max(playerRow.latestAt, getTime(action.createdAt));
  });

  reports.forEach((report) => {
    if (report.type === "player") {
      const targetPlayerIds = [...new Set([report.targetId, ...(report.reportedUserIds ?? [])].filter(Boolean))];
      targetPlayerIds.forEach((playerId) => addPlayerReport(playerId, report));
      return;
    }

    if (report.type === "team_emblem" || report.type === "team_name") {
      const team = teamById[report.targetId];
      const teamRow = pushGrouped(teamReviewMap, `team:${report.targetId}`, {
        title: team?.name ?? report.teamName ?? "알 수 없는 팀",
        subtitle: report.type === "team_emblem"
          ? `${team?.region ?? "지역 미정"} · 엠블럼 위반 ${team?.emblemViolationCount ?? 0}회`
          : `${team?.region ?? "지역 미정"} · 팀 이름 신고`,
        team,
        entityKind: "team",
      });
      addReport(teamRow, report);
      return;
    }

    if (report.type === "affiliation_name") {
      const affiliation = affiliationById[report.targetId];
      const affiliationRow = pushGrouped(teamReviewMap, `affiliation:${report.targetId}`, {
        title: affiliation?.name ?? report.affiliationName ?? "알 수 없는 소속",
        subtitle: `소속 이름 신고 · ${affiliation?.memberCount ?? report.affiliationMemberCount ?? 0}명`,
        affiliation,
        entityKind: "affiliation",
      });
      addReport(affiliationRow, report);
      return;
    }

    if (report.type === "match") {
      const match = matchMap[report.targetId];
      const matchRow = pushGrouped(matchReviewMap, report.targetId, {
        title: match?.title ?? "알 수 없는 경기",
        subtitle: `${match?.court ?? "미정 구장"} · ${match?.scheduledDate ?? ""} ${match?.scheduledTime ?? ""}`.trim(),
        match,
      });
      addReport(matchRow, report);

      const matchCourtName = match?.court || "미정 구장";
      const courtRow = pushGrouped(courtMap, `court-name:${matchCourtName}`, {
        title: matchCourtName,
        subtitle: `${match?.region ?? "지역 미정"} · 경기 신고`,
      });
      addReport(courtRow, report);

      const targetPlayerIds = report.reportedUserIds?.length ? report.reportedUserIds : getMatchPlayerIds(match);
      targetPlayerIds.forEach((playerId) => addPlayerReport(playerId, report));
      return;
    }

    if (report.type === "court_request") {
      const request = courtRequests.find((item) => item.id === report.targetId);
      const courtRow = pushGrouped(courtMap, `court-request:${report.targetId}`, {
        title: request?.name || "구장 등록요청",
        subtitle: `${request?.region ?? "지역 미정"} · 구장 등록 신고`,
      });
      addReport(courtRow, report);

      (report.reportedUserIds ?? [request?.requestedBy])
        .filter(Boolean)
        .forEach((playerId) => addPlayerReport(playerId, report));
      return;
    }

    if (report.type === "court") {
      const court = approvedCourts.find((item) => item.id === report.targetId);
      const courtRow = pushGrouped(courtMap, `court:${report.targetId}`, {
        title: court?.name || "구장",
        subtitle: `${court?.addressText ?? "주소 미정"} · 승인 구장 신고`,
      });
      addReport(courtRow, report);

      (report.reportedUserIds ?? [])
        .filter(Boolean)
        .forEach((playerId) => addPlayerReport(playerId, report));
      return;
    }

    if (report.type === "court_review") {
      const review = courtReviews.find((item) => item.id === report.targetId);
      const match = review?.matchId ? matchMap[review.matchId] : null;
      const courtName = review?.courtName || match?.court || "구장 리뷰";
      const courtRow = pushGrouped(courtMap, `court-review:${report.targetId}`, {
        title: courtName,
        subtitle: `${review?.rating ?? "-"}점 · 구장 리뷰 신고`,
      });
      if (review && !courtRow.courtReviews.some((item) => item.id === review.id)) courtRow.courtReviews.push(review);
      addReport(courtRow, report);

      if (match) {
        const matchRow = pushGrouped(matchReviewMap, match.id, {
          title: match.title ?? `${match.teamA?.name ?? "A"} vs ${match.teamB?.name ?? "B"}`,
          subtitle: `${match.court ?? "미정 구장"} · ${match.scheduledDate ?? ""} ${match.scheduledTime ?? ""}`.trim(),
          match,
        });
        addReport(matchRow, report);
      }

      (report.reportedUserIds ?? [review?.reviewerId])
        .filter(Boolean)
        .forEach((playerId) => addPlayerReport(playerId, report));
    }
  });

  const courtRows = [...courtMap.values()].map((row) => finalizeReviewRow({
    ...row,
    matchCount: row.matches.length,
    courtRequestCount: row.courtRequests.length,
    courtReviewCount: row.courtReviews.length,
    issueCount: row.openCount + row.matches.filter(isRecordIssueMatch).length,
  })).sort(sortReviewRows);
  const playerRows = [...playerMap.values()].map((row) => finalizeReviewRow({
    ...row,
    matchCount: row.matches.length,
    courtRequestCount: row.courtRequests.length,
    courtReviewCount: row.courtReviews.length,
    disciplinaryActionCount: row.disciplinaryActions.length,
    issueCount: row.openCount + row.matches.filter(isRecordIssueMatch).length,
  })).filter((row) => row.reportCount > 0 || row.courtRequestCount > 0 || row.courtReviewCount > 0 || row.disciplinaryActionCount > 0).sort(sortReviewRows);
  const matchRows = [...matchReviewMap.values()].map((row) => finalizeReviewRow({
    ...row,
    matchCount: row.matches.length,
    courtRequestCount: row.courtRequests.length,
    courtReviewCount: row.courtReviews.length,
    issueCount: row.openCount + (isRecordIssueMatch(row.match) ? 1 : 0),
  })).sort(sortReviewRows);
  const teamRows = [...teamReviewMap.values()].map((row) => finalizeReviewRow({
    ...row,
    matchCount: 0,
    courtRequestCount: 0,
    courtReviewCount: 0,
    issueCount: row.openCount,
  })).sort(sortReviewRows);

  return {
    summary: {
      reportCount: reports.length,
      openReportCount: getOpenCount(reports),
      courtCount: courtRows.length,
      playerCount: playerRows.length,
      matchIssueCount: matchRows.filter((row) => row.reportCount > 0 || isRecordIssueMatch(row.match)).length,
      courtRequestCount: courtRequests.length,
      disciplinaryActionCount: disciplinaryActions.length,
      teamEmblemIssueCount: teamRows.filter((row) => row.openCount > 0).length,
      nameIssueCount: teamRows.filter((row) => row.openCount > 0 && row.reports.some((report) => ["team_name", "affiliation_name"].includes(report.type))).length,
    },
    courts: courtRows,
    players: playerRows,
    matches: matchRows,
    teams: teamRows,
  };
}
