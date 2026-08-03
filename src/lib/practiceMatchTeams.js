import { PRACTICE_ID_PREFIX } from "./practiceMode.js";

export const PRACTICE_TEAM_A_ID = `${PRACTICE_ID_PREFIX}team-a`;
export const PRACTICE_TEAM_B_ID = `${PRACTICE_ID_PREFIX}team-b`;

export function makePracticeTeams(users = []) {
  const refereeId = users.find((user) => user.officialReferee === true)?.id ?? "";
  const playerIds = users.map((user) => user.id).filter((userId) => userId !== refereeId);
  const sideSize = Math.floor(playerIds.length / 2);
  return [
    {
      id: PRACTICE_TEAM_A_ID,
      name: "연습 A팀",
      mmr: 1200,
      members: playerIds.slice(0, sideSize).map((userId, index) => ({
        userId,
        role: index === 0 ? "captain" : "regular",
      })),
    },
    {
      id: PRACTICE_TEAM_B_ID,
      name: "연습 B팀",
      mmr: 1200,
      members: playerIds.slice(sideSize).map((userId, index) => ({
        userId,
        role: index === 0 ? "captain" : "regular",
      })),
    },
  ];
}
