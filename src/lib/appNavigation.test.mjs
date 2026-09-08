import assert from "node:assert/strict";
import test from "node:test";
import { APP_NAVIGATION_ITEMS, APP_SETTINGS_PATH, MY_NAVIGATION_ITEMS, getActiveAppNavigationPath, getActiveMyNavigationPath, getProfileNavigationItems } from "./appNavigation.js";
import { ADMIN_GRADE_META } from "./adminPolicy.js";
import { RECEIPT_SHELL_COPY } from "./receiptLocale.js";

test("primary navigation has the same six destinations and labels in either shell", () => {
  assert.deepEqual(APP_NAVIGATION_ITEMS.map((item) => RECEIPT_SHELL_COPY.ko[item.labelKey]), ["홈", "일정", "매칭", "플레이", "게시판", "나와 팀"]);
  assert.equal(new Set(APP_NAVIGATION_ITEMS.map((item) => item.to)).size, 6);
  for (const item of APP_NAVIGATION_ITEMS) {
    assert.ok(RECEIPT_SHELL_COPY.en[item.labelKey]);
    assert.equal(getActiveAppNavigationPath(item.to), item.to);
  }
});

test("secondary pages keep their parent navigation active without prefix collisions", () => {
  for (const path of ["/app/teams", "/app/teams/team-1", "/app/rankings", "/app/admin", "/app/profile/records", "/app/signup"]) {
    assert.equal(getActiveAppNavigationPath(path), "/app/profile", path);
  }
  for (const path of ["/app/operations", "/app/operations/queue", "/app/tournaments/cup-1", "/app/matches/match-1"]) {
    assert.equal(getActiveAppNavigationPath(path), "/app/matches", path);
  }
  for (const path of [APP_SETTINGS_PATH, `${APP_SETTINGS_PATH}/profile`, "/app/teamster", "/app/administer", "/app/notifications", "/"]) assert.equal(getActiveAppNavigationPath(path), "", path);
});

test("my navigation groups profile and team routes as peers without exposing unrelated pages", () => {
  assert.deepEqual(MY_NAVIGATION_ITEMS.map((item) => RECEIPT_SHELL_COPY.ko[item.labelKey]), ["내 프로필", "내 팀"]);
  for (const item of MY_NAVIGATION_ITEMS) {
    assert.ok(RECEIPT_SHELL_COPY.en[item.labelKey]);
    assert.equal(getActiveMyNavigationPath(item.to), item.to);
    assert.equal(getActiveMyNavigationPath(`${item.to}/detail`), item.to);
    assert.equal(getActiveMyNavigationPath(`${item.to}extra`), "");
  }
  for (const path of [APP_SETTINGS_PATH, "/app/recorder", "/app/rankings", "/app/admin", "/app/notifications", "/app/signup", "/"]) assert.equal(getActiveMyNavigationPath(path), "", path);
});

test("profile navigation preserves public routes and the existing server authority threshold", () => {
  const destinations = (options) => getProfileNavigationItems(options).map((item) => item.to);
  const publicDestinations = ["/app/rankings"];
  assert.deepEqual(destinations(), publicDestinations);
  assert.deepEqual(destinations({ guestPreview: true, adminLevel: ADMIN_GRADE_META.owner.level }), publicDestinations);
  assert.deepEqual(destinations({ adminLevel: ADMIN_GRADE_META.support.level - 1 }), publicDestinations);
  assert.deepEqual(destinations({ adminLevel: ADMIN_GRADE_META.support.level }), [...publicDestinations, "/app/admin"]);
});
