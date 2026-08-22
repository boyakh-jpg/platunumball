import assert from "node:assert/strict";
import http from "node:http";
import test from "node:test";
import nodeMcpHandler from "../api/mcp.js";
import { createBoxtierMcpHandler } from "../server/api/mcp.js";
import { consumeMcpReceiptGenerationQuota } from "../server/api/mcpQuota.js";

const TEST_PNG = Buffer.from("89504e470d0a1a0a", "hex");

function rpcRequest(method, params, id) {
  return new Request("https://boxtier.kr/mcp", {
    method: "POST",
    headers: {
      "accept": "application/json, text/event-stream",
      "content-type": "application/json",
    },
    body: JSON.stringify({ jsonrpc: "2.0", method, ...(params ? { params } : {}), id }),
  });
}

async function rpc(handler, method, params, id) {
  const response = await handler.fetch(rpcRequest(method, params, id));
  assert.equal(response.status, 200);
  const body = await response.text();
  if (response.headers.get("content-type")?.includes("text/event-stream")) {
    const data = body.split("\n").find((line) => line.startsWith("data: "))?.slice(6);
    assert.ok(data);
    return JSON.parse(data);
  }
  return JSON.parse(body);
}

test("Node adapter가 공개 MCP 요청을 처리한다", async (context) => {
  const server = http.createServer(nodeMcpHandler);
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  context.after(() => new Promise((resolve) => server.close(resolve)));

  const address = server.address();
  assert.notEqual(address, null);
  assert.equal(typeof address, "object");
  const response = await fetch(`http://127.0.0.1:${address.port}/mcp`, {
    method: "POST",
    headers: {
      accept: "application/json, text/event-stream",
      "content-type": "application/json",
      "x-forwarded-for": "198.51.100.10",
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      method: "tools/list",
      params: {},
      id: 10,
    }),
  });

  assert.equal(response.status, 200);
  assert.match(await response.text(), /create_basketball_receipt/);
});

test("Node adapter가 IP별 MCP POST를 1분 5회로 제한한다", async (context) => {
  const server = http.createServer(nodeMcpHandler);
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  context.after(() => new Promise((resolve) => server.close(resolve)));

  const address = server.address();
  assert.notEqual(address, null);
  assert.equal(typeof address, "object");
  const statuses = [];
  let limitedResponse = null;
  for (let index = 0; index < 6; index += 1) {
    const response = await fetch(`http://127.0.0.1:${address.port}/mcp`, {
      method: "POST",
      headers: {
        accept: "application/json, text/event-stream",
        "content-type": "application/json",
        "x-forwarded-for": "198.51.100.11",
      },
      body: JSON.stringify({ jsonrpc: "2.0", method: "tools/list", params: {}, id: 20 + index }),
    });
    statuses.push(response.status);
    if (response.status === 429) limitedResponse = response;
    else await response.text();
  }

  assert.deepEqual(statuses, [200, 200, 200, 200, 200, 429]);
  assert.ok(limitedResponse);
  assert.ok(limitedResponse.headers.get("retry-after"));
  assert.deepEqual(await limitedResponse.json(), { error: "mcp_rate_limited" });
});

test("MCP가 자동 선택용 영수증 도구를 공개한다", async () => {
  const handler = createBoxtierMcpHandler({ renderPng: async () => TEST_PNG });
  const initialized = await rpc(handler, "initialize", {
    protocolVersion: "2025-06-18",
    capabilities: {},
    clientInfo: { name: "boxtier-test", version: "1.0.0" },
  }, 1);
  assert.equal(initialized.result.serverInfo.name, "boxtier-receipt");

  const listed = await rpc(handler, "tools/list", {}, 2);
  const tool = listed.result.tools.find((candidate) => candidate.name === "create_basketball_receipt");
  assert.ok(tool);
  assert.match(tool.description, /박스티어/);
  assert.equal(tool.annotations.readOnlyHint, true);
  assert.ok(tool.inputSchema.properties.homeEmblem);
  assert.ok(tool.inputSchema.properties.awayEmblem);
  assert.equal(tool.inputSchema.properties.homeEmblem.additionalProperties, false);
  assert.deepEqual(tool.inputSchema.required.sort(), [
    "awayScore", "awayTeam", "format", "homeScore", "homeTeam", "playedOn", "venue",
  ].sort());
  await handler.close();
});

test("MCP 호출은 유효 입력의 일일 한도를 소비하고 PNG를 직접 반환한다", async () => {
  let renderCall = null;
  let quotaRequest = null;
  const handler = createBoxtierMcpHandler({
    consumeGenerationQuota: async (request) => {
      quotaRequest = request;
      return true;
    },
    renderPng: async (input) => {
      renderCall = input;
      return TEST_PNG;
    },
  });
  const called = await rpc(handler, "tools/call", {
    name: "create_basketball_receipt",
    arguments: {
      homeTeam: "SEOUL HOOPERS",
      awayTeam: "BUSAN WAVES",
      homeScore: 81,
      awayScore: 77,
      playedOn: "2026-08-21",
      venue: "RIVER COURT",
      format: "5v5",
      periodScores: [
        { label: "1Q", homeScore: 20, awayScore: 18 },
        { label: "2Q", homeScore: 19, awayScore: 21 },
        { label: "3Q", homeScore: 22, awayScore: 17 },
        { label: "4Q", homeScore: 20, awayScore: 21 },
      ],
    },
  }, 3);

  assert.equal(called.result.isError, undefined, JSON.stringify(called.result));
  assert.equal(called.result.content[1].type, "image");
  assert.equal(called.result.content[1].mimeType, "image/png");
  assert.equal(called.result.content[1].data, TEST_PNG.toString("base64"));
  assert.equal(renderCall.preset, "story");
  assert.equal(renderCall.draft.receiptStyle, "classic-thermal");
  assert.equal(quotaRequest instanceof Request, true);
  await handler.close();
});

test("MCP 호출은 처리된 엠블럼만 렌더러에 전달한다", async () => {
  let renderCall = null;
  const emblemBase64 = Buffer.from("prepared-webp-fixture").toString("base64");
  const handler = createBoxtierMcpHandler({
    consumeGenerationQuota: async () => true,
    renderPng: async (input) => {
      renderCall = input;
      return TEST_PNG;
    },
  });
  const called = await rpc(handler, "tools/call", {
    name: "create_basketball_receipt",
    arguments: {
      homeTeam: "SEOUL HOOPERS",
      awayTeam: "BUSAN WAVES",
      homeEmblem: { imageBase64: emblemBase64 },
      awayEmblem: { imageBase64: emblemBase64 },
      homeScore: 81,
      awayScore: 77,
      playedOn: "2026-08-21",
      venue: "RIVER COURT",
      format: "5v5",
    },
  }, 31);

  assert.equal(called.result.isError, undefined, JSON.stringify(called.result));
  assert.deepEqual(renderCall.emblems, {
    home: { imageBase64: emblemBase64 },
    away: { imageBase64: emblemBase64 },
  });
  await handler.close();
});

test("MCP 호출은 엠블럼 URL과 data URL을 렌더링 전에 거부한다", async () => {
  let renders = 0;
  let quotaCalls = 0;
  const handler = createBoxtierMcpHandler({
    consumeGenerationQuota: async () => {
      quotaCalls += 1;
      return true;
    },
    renderPng: async () => {
      renders += 1;
      return TEST_PNG;
    },
  });
  const baseArguments = {
    homeTeam: "A",
    awayTeam: "B",
    homeScore: 10,
    awayScore: 9,
    playedOn: "2026-08-21",
    venue: "COURT",
    format: "3x3",
  };
  const withUrl = await rpc(handler, "tools/call", {
    name: "create_basketball_receipt",
    arguments: { ...baseArguments, homeEmblemUrl: "https://example.com/emblem.webp" },
  }, 32);
  const withDataUrl = await rpc(handler, "tools/call", {
    name: "create_basketball_receipt",
    arguments: {
      ...baseArguments,
      homeEmblem: { imageBase64: "data:image/webp;base64,AAAA" },
    },
  }, 33);

  assert.equal(withUrl.result.isError, true);
  assert.equal(withDataUrl.result.isError, true);
  assert.equal(renders, 0);
  assert.equal(quotaCalls, 0);
  await handler.close();
});

test("쿼터 합계가 최종 점수와 다르면 렌더링을 거부한다", async () => {
  let renders = 0;
  let quotaCalls = 0;
  const handler = createBoxtierMcpHandler({
    consumeGenerationQuota: async () => {
      quotaCalls += 1;
      return true;
    },
    renderPng: async () => {
      renders += 1;
      return TEST_PNG;
    },
  });
  const called = await rpc(handler, "tools/call", {
    name: "create_basketball_receipt",
    arguments: {
      homeTeam: "A",
      awayTeam: "B",
      homeScore: 10,
      awayScore: 9,
      playedOn: "2026-08-21",
      venue: "COURT",
      format: "3x3",
      periodScores: [{ label: "REG", homeScore: 9, awayScore: 9 }],
    },
  }, 4);

  assert.equal(called.result.isError, true);
  assert.match(called.result.content[0].text, /totals_must_match_final_score/);
  assert.equal(renders, 0);
  assert.equal(quotaCalls, 0);
  await handler.close();
});

test("MCP 일일 한도를 넘으면 렌더링하지 않는다", async () => {
  let renders = 0;
  const handler = createBoxtierMcpHandler({
    consumeGenerationQuota: async () => false,
    renderPng: async () => {
      renders += 1;
      return TEST_PNG;
    },
  });
  const called = await rpc(handler, "tools/call", {
    name: "create_basketball_receipt",
    arguments: {
      homeTeam: "A",
      awayTeam: "B",
      homeScore: 10,
      awayScore: 9,
      playedOn: "2026-08-21",
      venue: "COURT",
      format: "3x3",
    },
  }, 5);

  assert.equal(called.result.isError, true);
  assert.match(called.result.content[0].text, /24시간 PNG 생성 한도 10회/);
  assert.equal(renders, 0);
  await handler.close();
});

test("MCP quota helper는 원본 IP 대신 해시로 전역 RPC를 호출한다", async () => {
  let rpcCall = null;
  const client = {
    async rpc(name, params) {
      rpcCall = { name, params };
      return { data: true, error: null };
    },
  };
  const allowed = await consumeMcpReceiptGenerationQuota(new Request("https://boxtier.kr/mcp", {
    headers: { "x-forwarded-for": "203.0.113.21" },
  }), { client });

  assert.equal(allowed, true);
  assert.equal(rpcCall.name, "consume_mcp_receipt_generation_quota");
  assert.match(rpcCall.params.p_request_hash, /^[0-9a-f]{64}$/);
  assert.doesNotMatch(rpcCall.params.p_request_hash, /203\.0\.113\.21/);
});

test("MCP 실제 renderer가 Feed PNG를 반환한다", async () => {
  const { default: sharp } = await import("sharp");
  const emblem = await sharp(Buffer.from(`
    <svg xmlns="http://www.w3.org/2000/svg" width="320" height="320">
      <circle cx="160" cy="160" r="140" fill="#111"/>
      <path d="M70 160h180M160 70v180" stroke="#fff" stroke-width="18"/>
    </svg>
  `)).webp().toBuffer();
  const handler = createBoxtierMcpHandler({ consumeGenerationQuota: async () => true });
  const called = await rpc(handler, "tools/call", {
    name: "create_basketball_receipt",
    arguments: {
      style: "thermal",
      preset: "feed",
      homeTeam: "서울 후퍼스",
      awayTeam: "부산 웨이브",
      homeScore: 81,
      awayScore: 77,
      playedOn: "2026-08-21",
      playedTime: "19:30",
      venue: "리버 코트",
      format: "5v5",
      homeEmblem: { imageBase64: emblem.toString("base64") },
      awayEmblem: { imageBase64: emblem.toString("base64") },
    },
  }, 6);

  assert.equal(called.result.isError, undefined, JSON.stringify(called.result));
  const png = Buffer.from(called.result.content[1].data, "base64");
  assert.deepEqual(png.subarray(0, 8), Buffer.from("89504e470d0a1a0a", "hex"));
  const metadata = await sharp(png).metadata();
  assert.equal(metadata.width, 1080);
  assert.equal(metadata.height, 1350);
  await handler.close();
});
