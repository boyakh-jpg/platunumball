import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { MATCHES_PAGE_SOURCE_PATHS, readSourceGroup } from "./management-source-groups.mjs";

import {
  getMatchListRoomComposition,
  getMatchListRoomTypeLabel,
  getPlayMatchRosterProjection,
  getScheduleMatchRosterProjection,
  isMatchupTitleDuplicate,
  normalizeMatchupText,
} from "../src/lib/matchListProjection.js";
import { attachMatchPlayerCountsToCards } from "../server/api/matches/_listEnrichment.js";
import { attachMatchCardReferences, collectMissingMatchCardReferences } from "../server/api/matches/_listProjection.js";
import { attachRecruitingCardReferences } from "../server/api/recruiting/_listProjection.js";
import { attachRoomFeedCardSource } from "../server/lib/roomFeedCards.js";
import { formatMatchTime } from "../src/pages/matchesPageBaseSelectors.js";

test("목록 카드는 승인 구장 원본과 실제 일정만 표시한다", () => {
  const courtById = { "court-1": { id: "court-1", name: "성산 농구장" } };
  const staleCard = { id: "match-1", courtId: "court-1", court: "미정" };

  assert.deepEqual(collectMissingMatchCardReferences([staleCard]).courtIds, ["court-1"]);
  assert.equal(attachMatchCardReferences(staleCard, {}, courtById).court, "성산 농구장");
  assert.equal(attachRecruitingCardReferences(staleCard, courtById).court, "성산 농구장");
  assert.deepEqual(attachRoomFeedCardSource({
    ...staleCard,
    scheduledDate: "2026-08-03",
    scheduledTime: "18:00",
  }, {
    id: "match-1",
    court_id: "court-1",
    court_name: "미정",
    scheduled_date: "2026-08-04",
    scheduled_time: "13:00:00",
    scheduled_at: "2026-08-04 13:00",
    timing_type: "scheduled",
  }), {
    ...staleCard,
    court: "미정",
    scheduledDate: "2026-08-04",
    scheduledTime: "13:00",
    scheduledAt: "2026-08-04 13:00",
    timingType: "scheduled",
  });
  assert.equal(formatMatchTime({ createdAt: "2026-08-03T12:34:00.000Z" }), "일정 미정");
});

test("대진 제목 비교는 대소문자와 공백만 정규화한다", () => {
  assert.equal(normalizeMatchupText("  Team A   VS   Team B  "), "team a vs team b");
  assert.equal(isMatchupTitleDuplicate(" Team A VS Team B ", {
    teamA: { name: "team a" },
    teamB: { name: "TEAM B" },
  }), true);
  assert.equal(isMatchupTitleDuplicate("오늘의 경기", {
    teamA: { name: "Team A" },
    teamB: { name: "Team B" },
  }), false);
});

test("목록 방 유형은 경기 사이드·팀 파티·모집 로비를 같은 규칙으로 계산한다", () => {
  assert.equal(getMatchListRoomTypeLabel({}), "개인 매칭");
  assert.equal(getMatchListRoomTypeLabel({
    teamA: { teamId: "team-a", players: ["a"] },
  }), "팀 파티 포함");
  assert.equal(getMatchListRoomTypeLabel({
    teamA: { teamId: "team-a" },
    teamB: { teamId: "team-b" },
  }), "팀전");
  assert.equal(getMatchListRoomTypeLabel({
    parties: [{ teamId: "team-a", players: ["a", "b"] }],
  }), "팀 파티 포함");
  assert.equal(getMatchListRoomTypeLabel({}, {
    entries: [
      { kind: "team", teamId: "team-a" },
      { joinMode: "team", teamId: "team-b" },
    ],
  }), "팀전");

  assert.deepEqual(getMatchListRoomComposition({
    teamA: { teamId: "team-a" },
  }, {
    entries: [{ kind: "team", teamId: "team-b" }],
  }), {
    matchTeamCount: 1,
    matchPartyCount: 0,
    lobbyTeamCount: 1,
  });
  assert.equal(getMatchListRoomTypeLabel({
    teamA: { teamId: "team-a" },
  }, {
    entries: [{ kind: "team", teamId: "team-b" }],
  }), "팀 파티 포함");
});

test("일정 목록 인원은 선언된 출전 수와 후보를 함께 센다", () => {
  assert.deepEqual(getScheduleMatchRosterProjection({
    teamA: {
      count: 3,
      players: ["a1"],
    },
    teamB: {
      count: -2,
      players: ["b1", "b2"],
    },
    reservePlayers: {
      teamA: ["ar1"],
      teamB: ["br1"],
    },
  }), {
    participantCount: 5,
    teamACount: 4,
    teamBCount: 1,
  });

  assert.deepEqual(getScheduleMatchRosterProjection({
    teamA: { players: ["a1", "a1"] },
    teamB: { players: ["b1"] },
    reservePlayers: { teamA: ["ar1"] },
  }), {
    participantCount: 3,
    teamACount: 2,
    teamBCount: 1,
  });
});

test("일정 목록 카드 count는 match_players에서 빠진 후보도 reserve_players로 복원한다", async () => {
  const rows = {
    match_players: [{ match_id: "match-1", side: "teamA", user_id: "host" }],
    matches: [{ id: "match-1", reserve_players: { teamA: [], teamB: ["taeo", "taeo"] } }],
  };
  const client = {
    from(table) {
      return {
        select() { return this; },
        in(column, ids) {
          return Promise.resolve({
            data: rows[table].filter((row) => ids.includes(row[column])),
            error: null,
          });
        },
      };
    },
  };
  const [counted] = await attachMatchPlayerCountsToCards(client, [{
    id: "match-1",
    teamA: { players: [], count: 0 },
    teamB: { players: [], count: 0 },
  }]);

  assert.deepEqual(getScheduleMatchRosterProjection(counted), {
    participantCount: 2,
    teamACount: 1,
    teamBCount: 1,
  });
});

test("플레이 목록 인원은 기존처럼 출전·후보를 구분해 표시한다", () => {
  const projection = getPlayMatchRosterProjection({
    teamA: { players: ["a1", "a2"] },
    teamB: { players: ["b1"] },
    playedPlayerIds: {
      teamA: ["a1", "a0"],
      teamB: ["b1"],
    },
    reservePlayers: {
      teamA: ["a2", "ar1"],
      teamB: ["br1"],
    },
    parties: [{
      side: "teamB",
      teamId: "team-b",
      players: ["b1"],
      reserves: ["br1", "br2"],
    }],
  });

  assert.deepEqual(projection, {
    participantCount: 4,
    reserveCount: 3,
    teamACount: 3,
    teamBCount: 3,
    meta: "참여 4명 · A 3 / B 3 · 후보 3",
  });
});

test("일정과 플레이 페이지는 카드 표시 계산을 공용 projection에서 읽는다", async () => {
  const [matchesSource, recorderSource] = await Promise.all([
    readSourceGroup((file) => readFile(new URL(`../${file}`, import.meta.url), "utf8"), MATCHES_PAGE_SOURCE_PATHS),
    readFile(new URL("../src/pages/Recorder.jsx", import.meta.url), "utf8"),
  ]);

  [matchesSource, recorderSource].forEach((source) => {
    assert.match(source, /from "\.\.\/lib\/matchListProjection\.js"/);
    assert.doesNotMatch(source, /function normalizeMatchupText\(/);
    assert.doesNotMatch(source, /function getRoomTypeLabel\(/);
    assert.doesNotMatch(source, /function getMatchSideCount\(/);
  });
});
