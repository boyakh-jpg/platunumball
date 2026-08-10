import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { toClientTeamWithMembers } from "../server/api/_supabaseAdmin.js";
import { toClientTeam as toMatchListTeam } from "../server/api/matches/list.js";
import { toTeam as toSearchTeam } from "../server/api/search.js";
import { mapRemoteTeamEmblem as mapSharedRemoteTeamEmblem } from "../shared/lib/teamEmblem.js";
import { projectTeamRow } from "../shared/lib/teamRowProjection.js";
import { toClientRecruitingTeam } from "../src/data/recruitingMappers.js";
import { fromRemoteTeam } from "../src/data/teamMappers.js";
import { mapRemoteTeamEmblem as mapClientRemoteTeamEmblem } from "../src/lib/teamEmblem.js";
import { isCurrentScopedOperation } from "../src/lib/asyncState.js";

const teamRow = {
  id: "team-1",
  name: "New Court Crew",
  description: "주말 저녁에 뛰는 팀",
  home_court: "court-1",
  region: "서울특별시 마포구",
  mmr: 1243,
  roster_mmr: 1211,
  performance_adjustment: 7,
  wins: 12,
  losses: 4,
  accent: "#ff5a47",
  emblem_key: "team/team-1.webp",
  emblem_source: "upload",
  emblem_updated_at: "2026-07-29T01:02:03.000Z",
  emblem_uploaded_at: "2026-07-28T01:02:03.000Z",
  emblem_upload_count: "2",
  emblem_color: "#112233",
  emblem_border_enabled: false,
  emblem_border_color: "#445566",
  emblem_text_mode: "abbreviation",
  emblem_abbreviation: "NCC",
  emblem_font: "gothic",
  emblem_violation_count: "1",
  emblem_upload_blocked_until: "2026-08-01T00:00:00.000Z",
  emblem_moderated_at: "2026-07-29T02:00:00.000Z",
  emblem_moderation_reason: "fixture",
  created_at: "2026-01-02T00:00:00.000Z",
  updated_at: "2026-07-29T00:00:00.000Z",
};

const memberRows = [
  { user_id: "user-2", role: "regular" },
  { user_id: "user-1", role: "captain" },
];

const commonTeam = {
  id: "team-1",
  name: "New Court Crew",
  description: "주말 저녁에 뛰는 팀",
  homeCourt: "court-1",
  region: "서울특별시 마포구",
  mmr: 1243,
  wins: 12,
  losses: 4,
  accent: "#ff5a47",
  emblemKey: "team/team-1.webp",
  emblemSource: "upload",
  emblemUpdatedAt: "2026-07-29T01:02:03.000Z",
  emblemUploadedAt: "2026-07-28T01:02:03.000Z",
  emblemUploadCount: 2,
  emblemColor: "#112233",
  emblemBorderEnabled: false,
  emblemBorderColor: "#445566",
  emblemTextMode: "abbreviation",
  emblemAbbreviation: "NCC",
  emblemFont: "gothic",
  createdAt: "2026-01-02T00:00:00.000Z",
  updatedAt: "2026-07-29T00:00:00.000Z",
};

test("이전 팀 엠블럼 완료는 이동한 팀의 복원 상태와 메시지를 바꾸지 않는다", async () => {
  let currentTeamId = "team-a";
  let currentOperation = { scopeId: currentTeamId, operationId: 1 };
  let emblemCanRestore = false;
  let feedback = "";
  let finishUpload;
  const upload = new Promise((resolve) => { finishUpload = resolve; });
  const operation = currentOperation;
  const completion = upload.then((result) => {
    if (!isCurrentScopedOperation(currentOperation, operation, currentTeamId)) return;
    emblemCanRestore = result.emblemCanRestore;
    feedback = "엠블럼을 변경했습니다.";
  });

  currentTeamId = "team-b";
  currentOperation = null;
  emblemCanRestore = true;
  feedback = "B 상태";
  finishUpload({ emblemCanRestore: false });
  await completion;

  assert.equal(emblemCanRestore, true);
  assert.equal(feedback, "B 상태");
});

test("team emblem client shim re-exports the shared canonical implementation", () => {
  assert.equal(mapClientRemoteTeamEmblem, mapSharedRemoteTeamEmblem);
  assert.deepEqual(mapClientRemoteTeamEmblem(teamRow), mapSharedRemoteTeamEmblem(teamRow));
});

test("shared team row projection owns common remote team fields", () => {
  assert.deepEqual(projectTeamRow(teamRow), commonTeam);
});

test("team row wrappers preserve their existing screen-specific shapes", () => {
  const sortedMembers = [
    { userId: "user-1", role: "captain" },
    { userId: "user-2", role: "regular" },
  ];

  assert.deepEqual(toClientRecruitingTeam(teamRow, memberRows), {
    ...commonTeam,
    membersPartial: false,
    members: sortedMembers,
  });
  assert.deepEqual(toMatchListTeam(teamRow), {
    ...commonTeam,
    membersPartial: true,
    members: [],
  });
  assert.deepEqual(toSearchTeam(teamRow, memberRows), {
    kind: "team",
    ...commonTeam,
    members: [
      { userId: "user-2", role: "regular" },
      { userId: "user-1", role: "captain" },
    ],
    searchText: "New Court Crew 서울특별시 마포구 court-1 team-1",
  });
  assert.deepEqual(toClientTeamWithMembers(teamRow, memberRows), {
    ...commonTeam,
    members: sortedMembers,
  });
  assert.deepEqual(fromRemoteTeam(teamRow, memberRows), {
    ...commonTeam,
    rosterMmr: 1211,
    performanceAdjustment: 7,
    emblemViolationCount: 1,
    emblemUploadBlockedUntil: "2026-08-01T00:00:00.000Z",
    emblemModeratedAt: "2026-07-29T02:00:00.000Z",
    emblemModerationReason: "fixture",
    members: sortedMembers,
  });
});

test("server team projections do not import the client team emblem module", async () => {
  const paths = [
    "server/api/_supabaseAdmin.js",
    "server/api/matches/_listProjection.js",
    "server/api/recruiting/_listProjection.js",
    "server/api/search.js",
    "server/api/teams/emblem.js",
  ];
  const sources = await Promise.all(paths.map((path) => readFile(new URL(`../${path}`, import.meta.url), "utf8")));
  assert.doesNotMatch(sources.join("\n"), /src\/lib\/teamEmblem\.js/);

  const clientShim = await readFile(new URL("../src/lib/teamEmblem.js", import.meta.url), "utf8");
  assert.match(clientShim, /export \* from "\.\.\/\.\.\/shared\/lib\/teamEmblem\.js";/);
});
