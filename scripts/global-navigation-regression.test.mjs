import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { getOAuthCallbackRedirectUrl, getOAuthCallbackState } from "../src/lib/authCallback.js";
import { getLoginPath, getSafeAppRedirect } from "../src/lib/profileSetup.js";

const readSource = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("OAuth 콜백 정리는 일반 anchor와 콜백 외 URL 값을 보존한다", () => {
  assert.deepEqual(getOAuthCallbackState("/privacy#details"), {
    hasCallback: false,
    code: "",
    error: "",
    pathname: "/privacy",
    cleanedPath: "/privacy#details",
  });

  const queryCallback = getOAuthCallbackState("/privacy?source=footer&error=access_denied#details");
  assert.equal(queryCallback.hasCallback, true);
  assert.equal(queryCallback.error, "access_denied");
  assert.equal(queryCallback.cleanedPath, "/privacy?source=footer#details");

  const queryCallbackWithParamLikeAnchor = getOAuthCallbackState("/privacy?error=access_denied#type=details");
  assert.equal(queryCallbackWithParamLikeAnchor.cleanedPath, "/privacy#type=details");

  const hashCallback = getOAuthCallbackState("/app/settings#access_token=secret&token_type=bearer&panel=security");
  assert.equal(hashCallback.hasCallback, true);
  assert.equal(hashCallback.cleanedPath, "/app/settings#panel=security");

  assert.deepEqual(getOAuthCallbackState("/app/receipt?code=BT-00000042"), {
    hasCallback: false,
    code: "",
    error: "",
    pathname: "/app/receipt",
    cleanedPath: "/app/receipt?code=BT-00000042",
  });
});

test("OAuth 공급자 복귀는 영수증 code와 충돌하지 않는 로그인 callback으로 고정한다", () => {
  const redirectUrl = new URL(getOAuthCallbackRedirectUrl(
    "https://boxtier.kr",
    "/app/receipt?code=BT-00000042",
  ));
  assert.equal(redirectUrl.pathname, "/login");
  assert.equal(redirectUrl.searchParams.get("authCallback"), "1");
  assert.equal(redirectUrl.searchParams.get("redirect"), "/app/receipt?code=BT-00000042");

  redirectUrl.searchParams.set("code", "supabase-pkce-code");
  const callbackState = getOAuthCallbackState(redirectUrl.toString());
  assert.equal(callbackState.hasCallback, true);
  assert.equal(callbackState.code, "supabase-pkce-code");
  assert.equal(callbackState.cleanedPath, "/login?redirect=%2Fapp%2Freceipt%3Fcode%3DBT-00000042");
});

test("공개 화면 OAuth 오류는 원래 안전한 backTo를 보존한 로그인 URL로 수렴한다", () => {
  const callbackState = getOAuthCallbackState("/privacy?error=access_denied#details");
  const loginPath = getLoginPath(
    getSafeAppRedirect(callbackState.cleanedPath),
    callbackState.cleanedPath,
  );
  const loginUrl = new URL(loginPath, "https://boxtier.local");

  assert.equal(loginUrl.pathname, "/login");
  assert.equal(loginUrl.searchParams.get("redirect"), "/app");
  assert.equal(loginUrl.searchParams.get("backTo"), "/privacy#details");
});

test("MCP OAuth 동의 복귀는 authorization_id 하나만 허용한다", () => {
  const consentPath = "/oauth/consent?authorization_id=authorization-123";
  assert.equal(getSafeAppRedirect(consentPath), consentPath);
  assert.equal(getSafeAppRedirect(`${consentPath}&extra=1`), "/app");
  assert.equal(getSafeAppRedirect(`${consentPath}#fragment`), "/app");
  assert.equal(getSafeAppRedirect("https://example.com/oauth/consent?authorization_id=x"), "/app");

  const loginUrl = new URL(getLoginPath(consentPath, consentPath), "https://boxtier.local");
  assert.equal(loginUrl.searchParams.get("redirect"), consentPath);
  assert.equal(loginUrl.searchParams.get("backTo"), consentPath);
});

test("Instagram 연결 복귀는 256비트 capability code 하나만 허용한다", () => {
  const code = "a".repeat(43);
  const connectPath = `/instagram/connect?code=${code}`;
  assert.equal(getSafeAppRedirect(connectPath), connectPath);
  assert.equal(getSafeAppRedirect(`${connectPath}&extra=1`), "/app");
  assert.equal(getSafeAppRedirect(`${connectPath}#fragment`), "/app");
  assert.equal(getSafeAppRedirect("/instagram/connect?code=short"), "/app");

  const loginUrl = new URL(getLoginPath(connectPath, connectPath), "https://boxtier.local");
  assert.equal(loginUrl.searchParams.get("redirect"), connectPath);
  assert.equal(loginUrl.searchParams.get("backTo"), connectPath);
});

test("Instagram 연결 화면은 Vercel SPA 진입점으로 rewrite한다", async () => {
  const config = JSON.parse(await readSource("vercel.json"));
  assert.ok(config.rewrites.some((rewrite) => (
    rewrite.source === "/instagram/connect" && rewrite.destination === "/index.html"
  )));
});

test("전역 인증·알림·fallback 경로는 canonical 진입점만 노출한다", async () => {
  const [
    authSession,
    sidebar,
    settings,
    notifications,
    homeRightRail,
    app,
    notFound,
  ] = await Promise.all([
    readSource("src/hooks/useAuthSession.js"),
    readSource("src/components/layout/Sidebar.jsx"),
    readSource("src/pages/SettingsPageView.jsx"),
    readSource("src/pages/Notifications.jsx"),
    readSource("src/components/home/HomeRightRail.jsx"),
    readSource("src/App.jsx"),
    readSource("src/pages/NotFound.jsx"),
  ]);

  assert.match(authSession, /useNavigate/);
  assert.match(authSession, /getOAuthCallbackState/);
  assert.match(authSession, /navigate\(callbackState\.cleanedPath, \{ replace: true \}\)/);
  assert.doesNotMatch(authSession, /history\.replaceState/);

  assert.doesNotMatch(sidebar, /sidebar-signout|auth\.signOut|LogOut/);
  assert.match(settings, /auth\.signOut/);

  assert.doesNotMatch(notifications, /selectNotificationView\("all"\)/);
  assert.match(notifications, /requestedView !== "all"/);
  assert.match(notifications, /setSearchParams\(nextParams, \{ replace: true \}\)/);
  assert.doesNotMatch(homeRightRail, /view=all|전체 알림/);
  assert.match(homeRightRail, /view=past/);

  assert.match(app, /path="\/app\/matches\/:matchId"/);
  assert.match(app, /path="\*" element=\{<NotFound \/>\}/);
  assert.doesNotMatch(app, /path="\*" element=\{<Navigate to="\/app"/);
  assert.match(notFound, /페이지를 찾을 수 없습니다/);
  assert.match(notFound, /to="\/app"/);
  assert.match(notFound, /to="\/"/);
});
