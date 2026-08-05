import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import * as sharedAffiliationMappers from "../shared/lib/affiliationMappers.js";
import * as sharedBrand from "../shared/lib/brand.js";
import * as sharedDiscordProtocol from "../shared/lib/discordProtocol.js";
import * as sharedInputSecurity from "../shared/lib/inputSecurity.js";
import * as sharedNotifications from "../shared/lib/notifications.js";
import * as sharedPracticeMode from "../shared/lib/practiceMode.js";
import * as sharedQueryPolicy from "../shared/lib/queryPolicy.js";
import * as sharedRemotePayloadMappers from "../shared/lib/remotePayloadMappers.js";
import * as sharedRepositoryColumns from "../shared/lib/repositoryColumns.js";
import * as sharedRepositoryDefaults from "../shared/lib/repositoryDefaults.js";
import * as sharedRoomChat from "../shared/lib/roomChat.js";
import * as sharedSettingsMappers from "../shared/lib/settingsMappers.js";
import * as sharedTeamEmblem from "../shared/lib/teamEmblem.js";
import * as clientAffiliationMappers from "../src/data/affiliationMappers.js";
import * as clientBrand from "../src/lib/brand.js";
import * as clientDiscordProtocol from "../src/lib/discordProtocol.js";
import * as clientInputSecurity from "../src/lib/inputSecurity.js";
import * as clientNotifications from "../src/lib/notifications.js";
import * as clientPracticeMode from "../src/lib/practiceMode.js";
import * as clientQueryPolicy from "../src/lib/queryPolicy.js";
import * as clientRemotePayloadMappers from "../src/data/remotePayloadMappers.js";
import * as clientRepositoryColumns from "../src/data/repositoryColumns.js";
import * as clientRepositoryDefaults from "../src/data/repositoryDefaults.js";
import * as clientRoomChat from "../src/lib/roomChat.js";
import * as clientSettingsMappers from "../src/data/settingsMappers.js";
import * as clientTeamEmblem from "../src/lib/teamEmblem.js";

const ROOT = path.resolve(new URL("..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"));

async function listJavaScriptFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(entries.map(async (entry) => {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) return listJavaScriptFiles(target);
    return entry.isFile() && /\.(?:js|mjs|jsx)$/.test(entry.name) ? [target] : [];
  }));
  return nested.flat();
}

test("기존 클라이언트 경로는 shared canonical export shape를 그대로 유지한다", () => {
  assert.deepEqual(
    Object.keys(clientRepositoryColumns).sort(),
    Object.keys(sharedRepositoryColumns).sort(),
  );
  assert.deepEqual(
    Object.keys(clientBrand).sort(),
    Object.keys(sharedBrand).sort(),
  );
  assert.deepEqual(
    Object.keys(clientDiscordProtocol).sort(),
    Object.keys(sharedDiscordProtocol).sort(),
  );
  assert.deepEqual(
    Object.keys(clientNotifications).sort(),
    Object.keys(sharedNotifications).sort(),
  );
  assert.deepEqual(
    Object.keys(clientPracticeMode).sort(),
    Object.keys(sharedPracticeMode).sort(),
  );
  assert.deepEqual(
    Object.keys(clientInputSecurity).sort(),
    Object.keys(sharedInputSecurity).sort(),
  );
  assert.deepEqual(
    Object.keys(clientQueryPolicy).sort(),
    Object.keys(sharedQueryPolicy).sort(),
  );
  assert.deepEqual(
    Object.keys(clientRoomChat).sort(),
    Object.keys(sharedRoomChat).sort(),
  );
  assert.deepEqual(
    Object.keys(clientTeamEmblem).sort(),
    Object.keys(sharedTeamEmblem).sort(),
  );
  assert.deepEqual(
    Object.keys(clientRemotePayloadMappers).sort(),
    Object.keys(sharedRemotePayloadMappers).sort(),
  );
  assert.deepEqual(
    Object.keys(clientAffiliationMappers).sort(),
    Object.keys(sharedAffiliationMappers).sort(),
  );
  assert.deepEqual(
    Object.keys(clientRepositoryDefaults).sort(),
    Object.keys(sharedRepositoryDefaults).sort(),
  );
  assert.deepEqual(
    Object.keys(clientSettingsMappers).sort(),
    Object.keys(sharedSettingsMappers).sort(),
  );

  for (const exportName of Object.keys(sharedRepositoryColumns)) {
    assert.strictEqual(clientRepositoryColumns[exportName], sharedRepositoryColumns[exportName]);
  }
  for (const exportName of Object.keys(sharedBrand)) {
    assert.strictEqual(clientBrand[exportName], sharedBrand[exportName]);
  }
  for (const exportName of Object.keys(sharedDiscordProtocol)) {
    assert.strictEqual(clientDiscordProtocol[exportName], sharedDiscordProtocol[exportName]);
  }
  for (const exportName of Object.keys(sharedNotifications)) {
    assert.strictEqual(clientNotifications[exportName], sharedNotifications[exportName]);
  }
  for (const exportName of Object.keys(sharedPracticeMode)) {
    assert.strictEqual(clientPracticeMode[exportName], sharedPracticeMode[exportName]);
  }
  for (const exportName of Object.keys(sharedInputSecurity)) {
    assert.strictEqual(clientInputSecurity[exportName], sharedInputSecurity[exportName]);
  }
  for (const exportName of Object.keys(sharedQueryPolicy)) {
    assert.strictEqual(clientQueryPolicy[exportName], sharedQueryPolicy[exportName]);
  }
  for (const exportName of Object.keys(sharedRoomChat)) {
    assert.strictEqual(clientRoomChat[exportName], sharedRoomChat[exportName]);
  }
  for (const exportName of Object.keys(sharedTeamEmblem)) {
    assert.strictEqual(clientTeamEmblem[exportName], sharedTeamEmblem[exportName]);
  }
  for (const exportName of Object.keys(sharedRemotePayloadMappers)) {
    assert.strictEqual(clientRemotePayloadMappers[exportName], sharedRemotePayloadMappers[exportName]);
  }
  for (const exportName of Object.keys(sharedAffiliationMappers)) {
    assert.strictEqual(clientAffiliationMappers[exportName], sharedAffiliationMappers[exportName]);
  }
  for (const exportName of Object.keys(sharedRepositoryDefaults)) {
    assert.strictEqual(clientRepositoryDefaults[exportName], sharedRepositoryDefaults[exportName]);
  }
  for (const exportName of Object.keys(sharedSettingsMappers)) {
    assert.strictEqual(clientSettingsMappers[exportName], sharedSettingsMappers[exportName]);
  }
  assert.strictEqual(sharedRepositoryDefaults.EMPTY_STATE.settings, sharedRepositoryDefaults.DEFAULT_SETTINGS);
  assert.equal(Object.isFrozen(sharedRepositoryDefaults.DEFAULT_SETTINGS), false);
  assert.equal(Object.isFrozen(sharedRepositoryDefaults.EMPTY_STATE), false);
});

test("src 호환 모듈은 구현을 복제하지 않고 shared 모듈만 재노출한다", async () => {
  const [
    repositoryShim,
    brandShim,
    discordShim,
    inputSecurityShim,
    notificationShim,
    practiceModeShim,
    queryPolicyShim,
    roomChatShim,
    teamEmblemShim,
    remotePayloadShim,
    affiliationShim,
    repositoryDefaultsShim,
    settingsMappersShim,
  ] = await Promise.all([
    readFile(path.join(ROOT, "src/data/repositoryColumns.js"), "utf8"),
    readFile(path.join(ROOT, "src/lib/brand.js"), "utf8"),
    readFile(path.join(ROOT, "src/lib/discordProtocol.js"), "utf8"),
    readFile(path.join(ROOT, "src/lib/inputSecurity.js"), "utf8"),
    readFile(path.join(ROOT, "src/lib/notifications.js"), "utf8"),
    readFile(path.join(ROOT, "src/lib/practiceMode.js"), "utf8"),
    readFile(path.join(ROOT, "src/lib/queryPolicy.js"), "utf8"),
    readFile(path.join(ROOT, "src/lib/roomChat.js"), "utf8"),
    readFile(path.join(ROOT, "src/lib/teamEmblem.js"), "utf8"),
    readFile(path.join(ROOT, "src/data/remotePayloadMappers.js"), "utf8"),
    readFile(path.join(ROOT, "src/data/affiliationMappers.js"), "utf8"),
    readFile(path.join(ROOT, "src/data/repositoryDefaults.js"), "utf8"),
    readFile(path.join(ROOT, "src/data/settingsMappers.js"), "utf8"),
  ]);

  assert.equal(repositoryShim.trim(), 'export * from "../../shared/lib/repositoryColumns.js";');
  assert.equal(brandShim.trim(), 'export * from "../../shared/lib/brand.js";');
  assert.equal(discordShim.trim(), 'export * from "../../shared/lib/discordProtocol.js";');
  assert.equal(inputSecurityShim.trim(), 'export * from "../../shared/lib/inputSecurity.js";');
  assert.equal(notificationShim.trim(), 'export * from "../../shared/lib/notifications.js";');
  assert.equal(practiceModeShim.trim(), 'export * from "../../shared/lib/practiceMode.js";');
  assert.equal(queryPolicyShim.trim(), 'export * from "../../shared/lib/queryPolicy.js";');
  assert.equal(roomChatShim.trim(), 'export * from "../../shared/lib/roomChat.js";');
  assert.equal(teamEmblemShim.trim(), 'export * from "../../shared/lib/teamEmblem.js";');
  assert.equal(remotePayloadShim.trim(), 'export * from "../../shared/lib/remotePayloadMappers.js";');
  assert.equal(affiliationShim.trim(), 'export * from "../../shared/lib/affiliationMappers.js";');
  assert.equal(repositoryDefaultsShim.trim(), 'export * from "../../shared/lib/repositoryDefaults.js";');
  assert.equal(settingsMappersShim.trim(), 'export * from "../../shared/lib/settingsMappers.js";');
});

test("server는 shared canonical 모듈의 src 호환 경로를 재귀적으로 참조하지 않는다", async () => {
  const serverFiles = await listJavaScriptFiles(path.join(ROOT, "server"));
  const sources = await Promise.all(serverFiles.map(async (file) => ({
    file,
    source: await readFile(file, "utf8"),
  })));
  const forbidden = /src\/(?:data\/(?:affiliationMappers|remotePayloadMappers|repositoryColumns|repositoryDefaults|settingsMappers)|lib\/(?:brand|discordProtocol|inputSecurity|notifications|practiceMode|queryPolicy|roomChat|teamEmblem))\.js/;

  for (const { file, source } of sources) {
    assert.doesNotMatch(source.replaceAll("\\", "/"), forbidden, path.relative(ROOT, file));
  }

  assert.ok(sources.some(({ source }) => source.includes("shared/lib/repositoryColumns.js")));
  assert.ok(sources.some(({ source }) => source.includes("shared/lib/brand.js")));
  assert.ok(sources.some(({ source }) => source.includes("shared/lib/discordProtocol.js")));
  assert.ok(sources.some(({ source }) => source.includes("shared/lib/inputSecurity.js")));
  assert.ok(sources.some(({ source }) => source.includes("shared/lib/notifications.js")));
  assert.ok(sources.some(({ source }) => source.includes("shared/lib/practiceMode.js")));
  assert.ok(sources.some(({ source }) => source.includes("shared/lib/queryPolicy.js")));
  assert.ok(sources.some(({ source }) => source.includes("shared/lib/roomChat.js")));
  assert.ok(sources.some(({ source }) => source.includes("shared/lib/teamEmblem.js")));
  assert.ok(sources.some(({ source }) => source.includes("shared/lib/remotePayloadMappers.js")));
  assert.ok(sources.some(({ source }) => source.includes("shared/lib/affiliationMappers.js")));
  assert.ok(sources.some(({ source }) => source.includes("shared/lib/repositoryDefaults.js")));
  assert.ok(sources.some(({ source }) => source.includes("shared/lib/settingsMappers.js")));
});

test("settings 기본값 병합과 Discord enabled 정책은 shared canonical 구현을 따른다", () => {
  const favoritePlayerIds = ["player-1"];
  const favoriteCourtIds = ["court-1"];
  const normalized = sharedSettingsMappers.normalizeSettings({
    theme: "light",
    privacy: { regionRanking: false },
    notificationChannels: {
      discord: {
        enabled: true,
        events: { approval: false },
      },
    },
  }, {
    fallbackSettings: {
      favoritePlayerIds,
      favoriteCourtIds,
    },
  });

  assert.equal(normalized.theme, "light");
  assert.deepEqual(normalized.privacy, {
    regionRanking: false,
    teamHistory: true,
    statSummary: true,
    communityPosts: true,
    communityComments: true,
  });
  assert.deepEqual(normalized.notificationChannels.discord, {
    enabled: true,
    events: {
      match: true,
      approval: false,
      report: true,
    },
  });
  assert.strictEqual(normalized.favoritePlayerIds, favoritePlayerIds);
  assert.strictEqual(normalized.favoriteCourtIds, favoriteCourtIds);
  assert.deepEqual(normalized.favoriteTeamIds, []);

  const discordFixtures = [
    { settings: {}, event: "match", expected: false },
    {
      settings: { notificationChannels: { discord: { enabled: true } } },
      event: "match",
      expected: true,
    },
    {
      settings: { notificationChannels: { discord: { enabled: true, events: { match: false } } } },
      event: "match",
      expected: false,
    },
    {
      settings: { notificationChannels: { discord: { enabled: false, events: { match: true } } } },
      event: "match",
      expected: false,
    },
  ];

  for (const fixture of discordFixtures) {
    assert.equal(
      sharedSettingsMappers.isDiscordNotificationEnabled(fixture.settings, fixture.event),
      fixture.expected,
    );
  }
});
