import assert from "node:assert/strict";
import test from "node:test";
import { getOAuthConsentDetails } from "../src/lib/oauthConsent.js";

test("OAuth 동의는 profile과 HTTPS 복귀 주소만 승인한다", () => {
  const result = getOAuthConsentDetails({
    client: { id: "client-1", name: "ChatGPT" },
    scope: "profile",
    redirect_uri: "https://chatgpt.com/connector_platform_oauth_redirect",
  });

  assert.equal(result.canApprove, true);
  assert.equal(result.redirectLabel, "https://chatgpt.com");
});

test("OAuth 동의는 알 수 없는 권한과 외부 HTTP 복귀 주소를 차단한다", () => {
  const unknownScope = getOAuthConsentDetails({
    client: { id: "client-1", name: "ChatGPT" },
    scope: "profile admin",
    redirect_uri: "https://chatgpt.com/oauth",
  });
  const insecureRedirect = getOAuthConsentDetails({
    client: { id: "client-1", name: "ChatGPT" },
    scope: "profile",
    redirect_uri: "http://example.com/oauth",
  });

  assert.deepEqual(unknownScope.unsupportedScopes, ["admin"]);
  assert.equal(unknownScope.canApprove, false);
  assert.equal(insecureRedirect.canApprove, false);
});

test("OAuth 동의는 로컬 MCP 클라이언트의 loopback HTTP를 허용한다", () => {
  const result = getOAuthConsentDetails({
    client: { id: "local-client", name: "Local MCP" },
    scope: "profile",
    redirect_uri: "http://127.0.0.1:49152/callback",
  });

  assert.equal(result.canApprove, true);
  assert.equal(result.redirectLabel, "http://127.0.0.1:49152");
});

test("OAuth 동의는 누락 정보를 ChatGPT로 추정하지 않는다", () => {
  const result = getOAuthConsentDetails({});

  assert.equal(result.clientName, "이름을 확인할 수 없는 외부 앱");
  assert.equal(result.canApprove, false);
});
