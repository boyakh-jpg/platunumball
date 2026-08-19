import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  getAccountRecoveryConnectionRequest,
  getAccountRecoveryLoginPath,
  getAuthProviderProfileName,
  getEnabledAuthProviders,
  getLinkedProviderIds,
  getSingleRecoverableProviderId,
  isKakaoAuthEnabled,
  isKakaoTalkInAppBrowser,
} from "../src/lib/authProviders.js";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("Kakao login stays hidden until the explicit feature flag is enabled", () => {
  assert.equal(isKakaoAuthEnabled("false"), false);
  assert.equal(isKakaoAuthEnabled("TRUE"), true);
  assert.deepEqual(
    getEnabledAuthProviders({ configured: true, kakaoEnabled: false }).map(({ id }) => id),
    ["google"],
  );
  assert.deepEqual(
    getEnabledAuthProviders({ configured: true, kakaoEnabled: true }).map(({ id }) => id),
    ["google", "kakao"],
  );
});

test("linked provider ids are derived from Supabase identities without duplicates", () => {
  assert.deepEqual(
    getLinkedProviderIds({
      identities: [
        { provider: "google" },
        { provider: "kakao" },
      ],
      app_metadata: {
        provider: "google",
        providers: ["google", "kakao", "unknown"],
      },
    }),
    ["google", "kakao"],
  );
});

test("provider display name only uses public profile metadata", () => {
  assert.equal(
    getAuthProviderProfileName({
      identities: [{ identity_data: { nickname: " 카카오 별명 " } }],
      user_metadata: { name: "fallback" },
    }),
    "카카오 별명",
  );
  assert.equal(
    getAuthProviderProfileName({
      identities: [],
      user_metadata: { full_name: " Google User " },
    }),
    "Google User",
  );
  assert.equal(
    getAuthProviderProfileName({
      identities: [],
      user_metadata: { email: "private@example.com" },
    }),
    "",
  );
});

test("account recovery only releases one supported OAuth identity", () => {
  assert.equal(getSingleRecoverableProviderId({ identities: [{ provider: "kakao" }] }), "kakao");
  assert.equal(
    getSingleRecoverableProviderId({
      identities: [{ provider: "google" }, { provider: "kakao" }],
    }),
    "",
  );
  assert.equal(getSingleRecoverableProviderId({ identities: [{ provider: "naver" }] }), "");
});

test("account recovery resumes the released provider connection after the existing login", () => {
  const loginPath = getAccountRecoveryLoginPath("google");
  const loginUrl = new URL(loginPath, "https://boxtier.kr");
  assert.equal(loginUrl.pathname, "/login");
  assert.equal(loginUrl.searchParams.get("recoverAccount"), "1");
  assert.equal(loginUrl.searchParams.get("excludeProvider"), "google");
  assert.equal(
    loginUrl.searchParams.get("redirect"),
    "/app/settings?section=main&connectProvider=google&autoConnect=1",
  );
  assert.deepEqual(
    getAccountRecoveryConnectionRequest(loginUrl.searchParams.get("redirect").split("?")[1]),
    { providerId: "google", autoConnect: true },
  );
  assert.equal(getAccountRecoveryLoginPath("naver"), "/login");
});

test("KakaoTalk embedded browser detection stays explicit", () => {
  assert.equal(isKakaoTalkInAppBrowser("Mozilla/5.0 KAKAOTALK 11.0.0"), true);
  assert.equal(isKakaoTalkInAppBrowser("Mozilla/5.0 Chrome/140"), false);
});

test("login entry points share the provider chooser and settings links identities explicitly", async () => {
  const [authHook, landing, receipt, login, signup, settings, releaseRoute, apiIndex, envExample] = await Promise.all([
    read("src/hooks/useAuthSession.js"),
    read("src/pages/Landing.jsx"),
    read("src/pages/MatchReceipt.jsx"),
    read("src/pages/Login.jsx"),
    read("src/pages/Signup.jsx"),
    read("src/pages/SettingsPageView.jsx"),
    read("server/api/profile/release-onboarding-identity.js"),
    read("api/index.js"),
    read(".env.example"),
  ]);

  assert.match(authHook, /supabase\.auth\.linkIdentity/);
  assert.match(authHook, /enabledProviders/);
  assert.match(landing, /getLoginPath/);
  assert.match(receipt, /getLoginPath/);
  assert.match(login, /isKakaoTalkInAppBrowser/);
  assert.match(signup, /이미 BOXTIER 아이디가 있어요/);
  assert.match(signup, /getAuthProviderProfileName/);
  assert.match(settings, /연결된 로그인/);
  assert.match(settings, /linkIdentityWithProvider/);
  assert.match(settings, /connectionRequest\.autoConnect/);
  assert.match(settings, /연결 마무리/);
  assert.match(settings, /result\?\.message/);
  assert.match(releaseRoute, /admin\.deleteUser/);
  assert.match(releaseRoute, /allowMissingProfile: true/);
  assert.match(releaseRoute, /기존 아이디 연결/);
  assert.match(apiIndex, /profile\/release-onboarding-identity/);
  assert.match(authHook, /manual linking/);
  assert.match(authHook, /message: errorMessage/);
  assert.match(envExample, /VITE_KAKAO_AUTH_ENABLED=false/);
});
