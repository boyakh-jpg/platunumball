import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  CREATE_MATCH_PAGE_SOURCE_PATHS,
  readSourceGroupSync,
} from "./management-source-groups.mjs";
import { createMatch } from "../src/data/repository.js";
import {
  getLinkedPersonalRecordDisplayUser,
  getSoloRecordLinkedRosterEntries,
  getSoloRecordRosterError,
  normalizeSoloRecordRosterInput,
} from "../src/lib/personalRecordRoster.js";

const users = [
  {
    id: "owner",
    name: "기록자",
    hashtag: "#owner",
    position: "PG",
    anonymous: false,
    trustScore: 100,
    ratings: { integrated: 1200, modes: { "2v2": 1200 } },
  },
  {
    id: "linked",
    name: "실제선수",
    hashtag: "#linked",
    position: "SG",
    region: "서울",
    anonymous: false,
    trustScore: 90,
    ratings: { integrated: 1250, modes: { "2v2": 1250 } },
  },
];

function getRecentKstSchedule() {
  const recordDate = new Date(Date.now() - 60_000);
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(recordDate).map((part) => [part.type, part.value]));
  return {
    scheduledDate: `${parts.year}-${parts.month}-${parts.day}`,
    scheduledTime: `${parts.hour}:${parts.minute}`,
  };
}

test("유효한 해시태그는 profile ID로 연결하고 표시명에서는 제거한다", () => {
  const normalized = normalizeSoloRecordRosterInput(
    "입력한이름 #linked C\n미등록 #missing PF",
    [],
    users,
  );
  assert.equal(normalized.text, "실제선수 SG\n미등록 PF");
  assert.deepEqual(normalized.refs, [{ profileId: "linked", name: "실제선수", position: "SG" }]);

  const roster = getSoloRecordLinkedRosterEntries(normalized.text, normalized.refs, users);
  assert.deepEqual(roster.entries, [
    { name: "실제선수", position: "SG", linkedProfileId: "linked" },
    { name: "미등록", position: "PF" },
  ]);
  assert.equal(getSoloRecordRosterError("3v3", normalized.text, "상대 C", normalized.refs, []), "");
});

test("연결 선수는 실제 프로필 표시를 사용하되 슬롯 ID는 참가 관계로 바꾸지 않는다", () => {
  const anonymousSlot = {
    id: "anon-1",
    name: "실제선수",
    position: "SG",
    anonymous: true,
    linkedProfileId: "linked",
  };
  const displayUser = getLinkedPersonalRecordDisplayUser(anonymousSlot, { linked: users[1] });
  assert.equal(displayUser.id, "linked");
  assert.equal(displayUser.name, "실제선수");
  assert.equal(displayUser.anonymous, false);
  assert.equal(anonymousSlot.id, "anon-1");
});

test("personal_record는 팀 점수와 본인 PTS를 분리하고 연결 선수를 익명 슬롯 참조로만 저장한다", () => {
  const schedule = getRecentKstSchedule();
  const state = {
    currentUserId: "owner",
    users,
    teams: [],
    matches: [],
    notifications: [],
    affiliations: [],
    settings: {},
    approvedCourts: [],
    courts: [],
  };
  const next = createMatch(state, {
    id: "personal-linked",
    title: "연결 선수 내 기록",
    recordType: "solo",
    recordEntryMode: "named",
    visibility: "private",
    mode: "2v2",
    ...schedule,
    soloScoreFor: 21,
    soloScoreAgainst: 17,
    soloStats: { points: 8, rebounds: 4, assists: 3, steals: 1, blocks: 0, fouls: 2 },
    soloTeamAName: "우리팀",
    soloTeamBName: "상대팀",
    soloTeamAPlayersText: "실제선수 SG",
    soloTeamBPlayersText: "상대 C",
    soloTeamAPlayerRefs: [{ profileId: "linked", name: "실제선수", position: "SG" }],
    soloTeamBPlayerRefs: [],
  });
  const match = next.matches[0];
  const linkedSlot = Object.values(match.anonymousPlayers).find((player) => player.linkedProfileId === "linked");

  assert.deepEqual(match.teamA.players, ["owner"]);
  assert.deepEqual(match.teamB.players, []);
  assert.ok(linkedSlot?.id.startsWith("anon_"));
  assert.ok(match.playedPlayerIds.teamA.includes(linkedSlot.id));
  assert.ok(!match.playedPlayerIds.teamA.includes("linked"));
  assert.equal(match.result.scoreA, 21);
  assert.equal(match.result.playerStats.owner.points, 8);
  assert.equal(match.result.playerStats.linked, undefined);
  assert.deepEqual(match.rules.recordSummary.teamAPlayerRefs, [{
    slotId: linkedSlot.id,
    linkedProfileId: "linked",
    name: "실제선수",
    position: "SG",
  }]);
  assert.ok(!JSON.stringify(match.rules.recordSummary).includes("#"));
});

test("이름 기록은 입력하지 않은 출전 슬롯을 무기명 선수로 채운다", () => {
  const schedule = getRecentKstSchedule();
  const state = {
    currentUserId: "owner",
    users,
    teams: [],
    matches: [],
    notifications: [],
    affiliations: [],
    settings: {},
    approvedCourts: [],
    courts: [],
  };
  const next = createMatch(state, {
    id: "personal-anonymous-fill",
    title: "빈 슬롯 보충",
    recordType: "solo",
    recordEntryMode: "named",
    visibility: "private",
    mode: "2v2",
    ...schedule,
    soloScoreFor: 10,
    soloScoreAgainst: 8,
    soloStats: { points: 6 },
    soloTeamAName: "우리팀",
    soloTeamBName: "상대팀",
    soloTeamAPlayersText: "김민준",
    soloTeamBPlayersText: "",
    soloTeamAPlayerRefs: [],
    soloTeamBPlayerRefs: [],
  });
  const match = next.matches[0];

  assert.equal(match.playedPlayerIds.teamA.length, 2);
  assert.equal(match.playedPlayerIds.teamB.length, 2);
  assert.equal(Object.keys(match.anonymousPlayers).length, 3);
  assert.deepEqual(match.rules.recordSummary.teamAPlayers, ["기록자", "김민준"]);
  assert.deepEqual(match.rules.recordSummary.teamBPlayers, ["무기명 1", "무기명 2"]);
});

test("빠른 기록도 출전 정원을 무기명 선수로 채운다", () => {
  const schedule = getRecentKstSchedule();
  const state = {
    currentUserId: "owner",
    users,
    teams: [],
    matches: [],
    notifications: [],
    affiliations: [],
    settings: {},
    approvedCourts: [],
    courts: [],
  };
  const next = createMatch(state, {
    id: "personal-quick-anonymous-fill",
    title: "빠른 기록 빈 슬롯 보충",
    recordType: "solo",
    recordEntryMode: "quick",
    visibility: "private",
    mode: "3v3",
    ...schedule,
    soloScoreFor: 12,
    soloScoreAgainst: 9,
    soloStats: { points: 7 },
  });
  const match = next.matches[0];

  assert.equal(match.playedPlayerIds.teamA.length, 3);
  assert.equal(match.playedPlayerIds.teamB.length, 3);
  assert.equal(Object.keys(match.anonymousPlayers).length, 5);
  assert.deepEqual(match.rules.recordSummary.teamAPlayers, ["기록자", "무기명 1", "무기명 2"]);
  assert.deepEqual(match.rules.recordSummary.teamBPlayers, ["무기명 1", "무기명 2", "무기명 3"]);
});

test("서버와 생성 UI가 연결 profile scope·공용 stepper·해시태그 제거 계약을 유지한다", () => {
  const authoritativeSource = readFileSync(new URL("../server/api/_authoritativeState.js", import.meta.url), "utf8");
  const validationSource = readFileSync(new URL("../server/lib/matchSnapshotValidation.js", import.meta.url), "utf8");
  const createSource = readSourceGroupSync(
    (file) => readFileSync(new URL(`../${file}`, import.meta.url), "utf8"),
    CREATE_MATCH_PAGE_SOURCE_PATHS,
  );

  assert.match(authoritativeSource, /soloTeamAPlayerRefs[\s\S]*?ref\?\.profileId/);
  assert.match(validationSource, /linkedProfileIds[\s\S]*?assertProfilesExist/);
  assert.match(validationSource, /solo_record_hashtag_not_allowed/);
  assert.match(createSource, /<NumericStepper/);
  assert.match(createSource, /soloStats[\s\S]*?points/);
  assert.doesNotMatch(createSource, /텍스트만 추가 · 유저 연결 없음/);
});
