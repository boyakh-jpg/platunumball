import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { API_ROUTES } from "../api/index.js";
import {
  getAccountWithdrawalIdentities,
  getAccountWithdrawalIdentity,
} from "../server/api/profile/_accountWithdrawal.js";
import { isValidParticipantRemovalReason, normalizeParticipantRemovalReason } from "../shared/lib/constants.js";
import { makeSuggestedHashtagBody } from "../shared/lib/handles.js";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("withdrawal identity follows the Google subject without storing raw identity", () => {
  const first = getAccountWithdrawalIdentity({
    id: "auth-1",
    email: "first@example.com",
    identities: [{ provider: "google", identity_id: "google-subject-1", identity_data: { sub: "google-subject-1" } }],
  });
  const recreated = getAccountWithdrawalIdentity({
    id: "auth-2",
    email: "changed@example.com",
    identities: [{ provider: "google", identity_id: "google-subject-1", identity_data: { sub: "google-subject-1" } }],
  });
  assert.equal(first, recreated);
  assert.match(first, /^[0-9a-f]{64}$/);
  assert.ok(!first.includes("google-subject-1"));
});

test("withdrawal cooldown covers every linked external identity", () => {
  const identities = getAccountWithdrawalIdentities({
    id: "auth-1",
    email: "first@example.com",
    identities: [
      { provider: "google", identity_id: "google-subject-1", identity_data: { sub: "google-subject-1" } },
      { provider: "kakao", identity_id: "kakao-subject-1", identity_data: { sub: "kakao-subject-1" } },
    ],
  });

  assert.equal(identities.length, 2);
  identities.forEach((identity) => assert.match(identity, /^[0-9a-f]{64}$/));
  assert.equal(new Set(identities).size, 2);
});

test("profile hashtag suggestion romanizes Korean and adds only an optional three-digit suffix", () => {
  assert.equal(makeSuggestedHashtagBody("강민준"), "gangminjun");
  assert.equal(makeSuggestedHashtagBody("ajs7113"), "ajs7113");
  assert.equal(makeSuggestedHashtagBody("강민준", "042"), "gangminjun042");
});

test("withdrawal route, linked cooldown, destructive warning, and hashtag floor stay enforced", async () => {
  const [migration, linkedMigration, settings, signup, upsert, withdrawRoute] = await Promise.all([
    read("supabase/migrations/20260805190000_account_withdrawal.sql"),
    read("supabase/migrations/20260815140000_account_withdrawal_linked_identities.sql"),
    read("src/pages/SettingsPageView.jsx"),
    read("src/pages/Signup.jsx"),
    read("server/api/profile/upsert.js"),
    read("server/api/profile/withdraw.js"),
  ]);
  assert.deepEqual(API_ROUTES.get("/profile/withdraw")?.methods, ["POST"]);
  assert.equal(API_ROUTES.get("/profile/withdraw")?.auth, "user");
  assert.match(migration, /interval '7 days'/);
  assert.match(migration, /where withdrawn_at is null/);
  assert.match(linkedMigration, /rankball_withdraw_linked_account/);
  assert.match(linkedMigration, /p_identity_hashes text\[\]/);
  assert.match(withdrawRoute, /getAccountWithdrawalIdentities/);
  assert.match(withdrawRoute, /p_identity_hashes/);
  assert.match(withdrawRoute, /rankball_withdraw_account/);
  assert.match(withdrawRoute, /account_withdrawal_migration_required/);
  assert.match(settings, /프로필과 개인 기록은 복구할 수 없습니다/);
  assert.match(settings, /연결된 모든 로그인 계정은 탈퇴 후 7일 동안 다시 가입할 수 없습니다/);
  assert.match(settings, /withdrawalAcknowledged/);
  assert.match(settings, /type="checkbox"/);
  assert.match(signup, /PROFILE_HASHTAG_MIN_LENGTH/);
  assert.match(upsert, /hashtag_too_short/);
  assert.match(upsert, /assertAccountRejoinAllowed/);
});

test("participant removal reason is trimmed and constrained", () => {
  assert.equal(normalizeParticipantRemovalReason("  출석 명단 정리  "), "출석 명단 정리");
  assert.equal(isValidParticipantRemovalReason("짧음"), false);
  assert.equal(isValidParticipantRemovalReason("출석 명단 정리"), true);
  assert.equal(isValidParticipantRemovalReason("가".repeat(201)), false);
});
