import assert from "node:assert/strict";
import test from "node:test";
import {
  fetchDiscordApi,
  getDiscordBotAuthorization,
} from "./discordHttp.js";

test("Discord HTTP 공용 코어는 인증, 응답 shape, 오류 변환을 보존한다", async (context) => {
  assert.equal(getDiscordBotAuthorization(" token "), "Bot token");
  assert.equal(getDiscordBotAuthorization("Bot token"), "Bot token");
  assert.equal(getDiscordBotAuthorization(""), "");

  const originalFetch = globalThis.fetch;
  context.after(() => {
    globalThis.fetch = originalFetch;
  });

  let request = null;
  globalThis.fetch = async (url, options) => {
    request = { url, options };
    return {
      ok: true,
      status: 204,
      text: async () => "",
    };
  };

  assert.equal(
    await fetchDiscordApi("/users/@me", { method: "GET" }, { authorization: "Bot test" }),
    null,
  );
  assert.equal(request.url, "https://discord.com/api/v10/users/@me");
  assert.equal(request.options.headers.Authorization, "Bot test");
  assert.equal(request.options.headers["Content-Type"], "application/json");
  assert.deepEqual(
    await fetchDiscordApi("/users/@me", {}, { authorization: "Bot test", emptyBody: {} }),
    {},
  );

  globalThis.fetch = async () => ({
    ok: false,
    status: 429,
    text: async () => JSON.stringify({ message: "rate limited" }),
  });
  await assert.rejects(
    fetchDiscordApi("/channels/1/messages", {}, { authorization: "Bot test" }),
    (error) => error.statusCode === 502
      && error.message === "discord_api_failed:429:/channels/1/messages:rate limited",
  );
});
