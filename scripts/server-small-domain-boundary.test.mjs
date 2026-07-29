import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import * as sharedAdminUserOperations from "../shared/lib/adminUserOperations.js";
import * as sharedAffiliations from "../shared/lib/affiliations.js";
import * as sharedEmblemPolicy from "../shared/lib/emblemPolicy.js";
import * as sharedProfileIcons from "../shared/lib/profileIcons.js";
import * as sharedRating from "../shared/lib/rating.js";
import * as sharedRatingPolicy from "../shared/lib/ratingPolicy.js";
import * as sharedRefereeExamBank from "../shared/lib/refereeExamBank.js";
import * as sharedTier from "../shared/lib/tier.js";
import * as sharedTrustUtils from "../shared/lib/trustUtils.js";
import { formatKoreanDateTime, formatMatchWindowTime } from "../shared/lib/matchUtils.js";
import { projectProfileSettings } from "../shared/lib/settingsMappers.js";
import * as clientAdminUserOperations from "../src/lib/adminUserOperations.js";
import * as clientAffiliations from "../src/lib/affiliations.js";
import * as clientEmblemPolicy from "../src/lib/emblemPolicy.js";
import * as clientProfileIcons from "../src/lib/profileIcons.js";
import * as clientRating from "../src/lib/rating.js";
import * as clientRatingPolicy from "../src/lib/ratingPolicy.js";
import * as clientRefereeExamBank from "../src/lib/refereeExamBank.js";
import * as clientTier from "../src/lib/tier.js";
import * as clientTrustUtils from "../src/data/trustUtils.js";
import {
  getAdminRestoreRatingFactor,
  getPickupTeamAssignmentRatingScale,
  getPostgameRecordMmrScale,
  getRecruitingRatingScale,
  getTournamentRatingScale,
} from "../shared/lib/ratingAuthority.js";
import {
  AGE_GROUPS,
  getAgeGroupByBirthYear,
  getAgeGroupForUser,
  getAgeGroupLabel,
  getAgeGroupSeasonForDate,
  getAgeGroupSeasonLabel,
  shouldRecheckAgeGroup,
} from "../shared/lib/profileSetup.js";
import * as clientProfileSetup from "../src/lib/profileSetup.js";
import * as sharedCourts from "../shared/lib/courts.js";
import * as clientCourts from "../src/lib/courts.js";

const ROOT = path.resolve(new URL("..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"));

async function listRuntimeJavaScriptFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(entries.map(async (entry) => {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) return listRuntimeJavaScriptFiles(target);
    if (!entry.isFile() || !/\.js$/.test(entry.name)) return [];
    return [target];
  }));
  return nested.flat();
}

function assertSameModule(clientModule, sharedModule) {
  assert.deepEqual(Object.keys(clientModule).sort(), Object.keys(sharedModule).sort());
  for (const exportName of Object.keys(sharedModule)) {
    assert.strictEqual(clientModule[exportName], sharedModule[exportName], exportName);
  }
}

test("small shared domain compatibility modules preserve export identity", () => {
  [
    [clientAdminUserOperations, sharedAdminUserOperations],
    [clientAffiliations, sharedAffiliations],
    [clientEmblemPolicy, sharedEmblemPolicy],
    [clientProfileIcons, sharedProfileIcons],
    [clientRating, sharedRating],
    [clientRatingPolicy, sharedRatingPolicy],
    [clientRefereeExamBank, sharedRefereeExamBank],
    [clientTier, sharedTier],
    [clientTrustUtils, sharedTrustUtils],
  ].forEach(([clientModule, sharedModule]) => assertSameModule(clientModule, sharedModule));
});

test("profile age and court naming compatibility exports share canonical functions", () => {
  const profileAgeExports = {
    AGE_GROUPS,
    getAgeGroupByBirthYear,
    getAgeGroupForUser,
    getAgeGroupLabel,
    getAgeGroupSeasonForDate,
    getAgeGroupSeasonLabel,
    shouldRecheckAgeGroup,
  };
  for (const [exportName, value] of Object.entries(profileAgeExports)) {
    assert.strictEqual(clientProfileSetup[exportName], value, exportName);
  }

  [
    "buildCourtAddressNameUpdates",
    "getCourtAddressFacilityName",
    "getCourtAddressKey",
    "getCourtFacilityBaseName",
    "getCourtRequestName",
    "getCourtStandardName",
    "normalizeCourtFacilityName",
    "normalizeCourtNamePart",
    "normalizeCourtSigungu",
  ].forEach((exportName) => {
    assert.strictEqual(clientCourts[exportName], sharedCourts[exportName], exportName);
  });
});

test("shared rating and age policies retain current fixtures", () => {
  assert.equal(getRecruitingRatingScale({ ranked: false, mmrRangeMode: "narrow" }), 0);
  assert.equal(getRecruitingRatingScale({ mmrRangeMode: "narrow" }), 1.1);
  assert.equal(getRecruitingRatingScale({ mmrRangeMode: "unknown" }), 1);
  assert.equal(getPickupTeamAssignmentRatingScale("manual"), 0.9);
  assert.equal(getPickupTeamAssignmentRatingScale("unknown"), 1.1);
  assert.equal(getPostgameRecordMmrScale({ mode: "1v1" }), 0.1);
  assert.equal(getPostgameRecordMmrScale({ mode: "5v5" }), 0.5);
  assert.equal(getPostgameRecordMmrScale({ mode: "unknown" }), 0);
  assert.equal(getTournamentRatingScale(false), 0.8);
  assert.equal(getTournamentRatingScale(true), 1);
  assert.equal(getAdminRestoreRatingFactor("restoreMatchHalf"), 0.5);
  assert.equal(getAdminRestoreRatingFactor("restoreMatch"), 1);

  const now = new Date("2026-07-30T00:00:00.000Z");
  assert.equal(getAgeGroupByBirthYear(2014, now), "junior");
  assert.equal(getAgeGroupByBirthYear(2013, now), "rising");
  assert.equal(getAgeGroupByBirthYear(2006, now), "open");
  assert.equal(getAgeGroupForUser({ birthYear: 2013, ageGroup: "open" }, now), "rising");
  assert.equal(AGE_GROUPS.length, 3);
});

test("경기 마감 시각은 경기방과 추천 패널이 같은 표시 helper를 사용한다", async () => {
  const value = "2026-07-30T12:34:00.000Z";
  assert.equal(formatMatchWindowTime(""), "일정 없음");
  assert.equal(formatMatchWindowTime(value), formatKoreanDateTime(value, {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }));

  const [matchRoomSource, recommendationSource] = await Promise.all([
    readFile(path.join(ROOT, "src/pages/MatchRoom.jsx"), "utf8"),
    readFile(path.join(ROOT, "src/components/match/MatchRecommendationPanel.jsx"), "utf8"),
  ]);
  [matchRoomSource, recommendationSource].forEach((source) => {
    assert.match(source, /formatMatchWindowTime/u);
    assert.doesNotMatch(source, /function format(?:WindowTime|CloseTime)\(/u);
  });
});

test("프로필 설정 projection은 관계형 즐겨찾기 권위와 partial fallback을 보존한다", async () => {
  const remoteSettings = {
    theme: "light",
    privacy: { statsPublic: false },
    notificationChannels: { discord: { enabled: true } },
    favoritePlayerIds: ["fallback-player"],
    favoriteTeamIds: ["fallback-team"],
  };
  const favoriteRows = [
    { target_type: "player", target_id: "player-1" },
    { target_type: "player", target_id: "player-2" },
    { target_type: "team", target_id: "team-1" },
    { target_type: "court", target_id: "court-1" },
    { target_type: "referee", target_id: "referee-1" },
  ];
  const authoritative = projectProfileSettings(remoteSettings, favoriteRows, {
    overrides: { approvedCourts: [{ id: "court-1" }] },
  });
  assert.deepEqual(authoritative.favoritePlayerIds, ["player-1", "player-2"]);
  assert.deepEqual(authoritative.favoriteTeamIds, ["team-1"]);
  assert.deepEqual(authoritative.favoriteCourtIds, ["court-1"]);
  assert.deepEqual(authoritative.favoriteRefereeIds, ["referee-1"]);
  assert.strictEqual(authoritative.privacy, remoteSettings.privacy);
  assert.strictEqual(authoritative.notificationChannels, remoteSettings.notificationChannels);
  assert.deepEqual(authoritative.approvedCourts, [{ id: "court-1" }]);

  const partial = projectProfileSettings(remoteSettings, favoriteRows, {
    favoriteRowsAuthoritative: false,
  });
  assert.deepEqual(partial.favoritePlayerIds, ["fallback-player"]);
  assert.deepEqual(partial.favoriteTeamIds, ["fallback-team"]);
  assert.deepEqual(partial.favoriteCourtIds, []);
  assert.deepEqual(partial.favoriteRefereeIds, []);

  const [repositorySource, profileMeSource] = await Promise.all([
    readFile(path.join(ROOT, "src/data/repository.js"), "utf8"),
    readFile(path.join(ROOT, "server/api/profile/me.js"), "utf8"),
  ]);
  assert.match(repositorySource, /projectProfileSettings\(remoteAppSettings, favoriteRows/u);
  assert.match(profileMeSource, /projectProfileSettings\(remoteAppSettings, favoriteRows/u);
  assert.match(profileMeSource, /favoriteRowsAuthoritative: includeFavorites/u);
});

test("server runtime imports shared canonical small domains instead of src compatibility paths", async () => {
  const serverFiles = await listRuntimeJavaScriptFiles(path.join(ROOT, "server"));
  const sources = await Promise.all(serverFiles.map(async (file) => ({
    file,
    source: await readFile(file, "utf8"),
  })));
  const forbidden = /src\/(?:data\/trustUtils|lib\/(?:adminUserOperations|affiliations|courts|emblemPolicy|profileIcons|profileSetup|rating|ratingPolicy|refereeExamBank|tier))\.js/;

  for (const { file, source } of sources) {
    assert.doesNotMatch(source.replaceAll("\\", "/"), forbidden, path.relative(ROOT, file));
  }

  [
    "shared/lib/adminUserOperations.js",
    "shared/lib/affiliations.js",
    "shared/lib/courts.js",
    "shared/lib/emblemPolicy.js",
    "shared/lib/profileIcons.js",
    "shared/lib/profileSetup.js",
    "shared/lib/rating.js",
    "shared/lib/ratingAuthority.js",
    "shared/lib/refereeExamBank.js",
    "shared/lib/tier.js",
    "shared/lib/trustUtils.js",
  ].forEach((canonicalPath) => {
    assert.ok(sources.some(({ source }) => source.includes(canonicalPath)), canonicalPath);
  });
});

test("full compatibility files stay one-line shared re-exports", async () => {
  const expected = new Map([
    ["src/data/trustUtils.js", 'export * from "../../shared/lib/trustUtils.js";'],
    ["src/lib/adminUserOperations.js", 'export * from "../../shared/lib/adminUserOperations.js";'],
    ["src/lib/affiliations.js", 'export * from "../../shared/lib/affiliations.js";'],
    ["src/lib/emblemPolicy.js", 'export * from "../../shared/lib/emblemPolicy.js";'],
    ["src/lib/profileIcons.js", 'export * from "../../shared/lib/profileIcons.js";'],
    ["src/lib/rating.js", 'export * from "../../shared/lib/rating.js";'],
    ["src/lib/ratingPolicy.js", 'export * from "../../shared/lib/ratingPolicy.js";'],
    ["src/lib/refereeExamBank.js", 'export * from "../../shared/lib/refereeExamBank.js";'],
    ["src/lib/tier.js", 'export * from "../../shared/lib/tier.js";'],
  ]);

  for (const [relativePath, expectedSource] of expected) {
    const source = await readFile(path.join(ROOT, relativePath), "utf8");
    assert.equal(source.trim(), expectedSource, relativePath);
  }
});
