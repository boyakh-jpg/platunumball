import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  getEnabledAuthProviders,
  getLinkedProviderIds,
  isKakaoAuthEnabled,
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

test("login entry points share the provider chooser and settings links identities explicitly", async () => {
  const [authHook, landing, receipt, settings, envExample] = await Promise.all([
    read("src/hooks/useAuthSession.js"),
    read("src/pages/Landing.jsx"),
    read("src/pages/MatchReceipt.jsx"),
    read("src/pages/SettingsPageView.jsx"),
    read(".env.example"),
  ]);

  assert.match(authHook, /supabase\.auth\.linkIdentity/);
  assert.match(authHook, /enabledProviders/);
  assert.match(landing, /getLoginPath/);
  assert.match(receipt, /getLoginPath/);
  assert.match(settings, /연결된 로그인/);
  assert.match(settings, /linkIdentityWithProvider/);
  assert.match(envExample, /VITE_KAKAO_AUTH_ENABLED=false/);
});
