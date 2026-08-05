import { demoFlowState } from "./demoFlowState.js";
import {
  DELETED_SYNTHETIC_COURT_IDS,
  baseState,
} from "./mockData/baseState.js";
import {
  uniqueById,
  withCanonicalUserHashtags,
  withDemoRefereeQualifications,
  withoutDeletedSyntheticCourts,
} from "./mockData/stateFinalizers.js";

// Seed/local-dev data. Production imports it only for the read-only guest home preview.
const demoSurnames = ["강", "김", "박", "이", "최", "정", "한", "오", "문", "서", "윤", "장", "배", "권", "노", "신"];
const demoGivenNames = ["도하", "이준", "채원", "하준", "라온", "서진", "지민", "유겸", "태린", "아린", "현준", "나겸", "시우", "예준", "하온", "민서"];
const demoSchools = ["연희대", "건대", "서강대", "한양대", "중앙대", "상암고", "동교고", "잠실고"];
const demoCompanies = ["라임랩", "스틸픽", "오픈코트", "플레이메이트", "넥스트런", "픽앤롤", "프리랜서"];
const demoClubs = ["노을농구회", "브릿지볼", "림파이어", "메테오스", "리버런", "언더패스"];
const demoColors = ["#58d2c0", "#f4c74f", "#ff8a5b", "#74a8ff", "#d98cff", "#ff6f61", "#7bd389", "#f05d5e", "#ffc857", "#8ac7db"];
const demoTeamNames = [
  "Noeul Kings", "Bridge Ballers", "Rimfire", "Ttukseom Flow", "Jamsil Meteors",
  "Sunset Riders", "Underpass Five", "Factory Hoops", "Blue Gym", "River Slash",
  "Court Atlas", "Night Switch", "Rookie Press", "Arc Shooters", "Steel Motion",
  "Lime Runners", "West Paint", "East Break", "High Glass", "Street Pulse",
];

import { buildDemoUsers, buildDemoTeams, buildDemoMatches, padNumber } from "./mockData/matchGenerators.js";
import { buildDemoRecruitingRooms } from "./mockData/recruitingGenerators.js";

function buildDemoReports(matches, users) {
  return Array.from({ length: 12 }, (_item, index) => {
    const match = matches.find((item) => item.id === `ma${padNumber((index % 36) + 1, 3)}`) ?? matches[index];
    return {
      id: `rd${padNumber(index + 1, 3)}`,
      type: "match",
      targetId: match.id,
      by: users[(index * 11) % users.length].id,
      reason: index % 2 ? "리바운드 기록 재확인이 필요합니다." : "어시스트 기록 확인 요청입니다.",
      status: index % 5 === 0 ? "resolved" : "open",
      createdAt: "2026-06-08T11:00:00.000Z",
    };
  });
}

function withDemoLeague(state) {
  const users = buildDemoUsers(state.users);
  const teams = buildDemoTeams(state.teams, users);
  const matches = buildDemoMatches(state.matches, teams, users);
  const recruitingPosts = buildDemoRecruitingRooms(teams, users);
  const reports = [...state.reports, ...buildDemoReports(matches, users)];
  const recruitingIds = new Set(recruitingPosts.map((post) => post.id));
  const notifications = state.notifications.filter((notification) => (
    !notification.recruitingPostId || recruitingIds.has(notification.recruitingPostId)
  ));

  return {
    ...state,
    users: uniqueById(users),
    teams: uniqueById(teams),
    matches: uniqueById(matches),
    recruitingPosts: uniqueById(recruitingPosts),
    notifications: uniqueById(notifications),
    reports: uniqueById(reports),
    settings: {
      ...state.settings,
      favoriteTeamIds: [...new Set([...(state.settings?.favoriteTeamIds ?? []), "td01", "td02", "td03", "td04"])],
      favoriteCourtIds: [...new Set(state.settings?.favoriteCourtIds ?? [])]
        .filter((courtId) => !DELETED_SYNTHETIC_COURT_IDS.has(courtId)),
    },
  };
}

export const sourceDemoState = withoutDeletedSyntheticCourts(
  withCanonicalUserHashtags(withDemoRefereeQualifications(withDemoLeague(baseState))),
);
export const initialState = withoutDeletedSyntheticCourts(
  withCanonicalUserHashtags(withDemoRefereeQualifications(demoFlowState ?? sourceDemoState)),
);
