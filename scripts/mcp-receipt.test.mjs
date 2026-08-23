import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import http from "node:http";
import test from "node:test";
import nodeMcpHandler from "../api/mcp.js";
import { createBoxtierMcpHandler } from "../server/api/mcp.js";
import { consumeMcpReceiptGenerationQuota } from "../server/api/mcpQuota.js";
import { MCP_RECEIPT_WIDGET_URI } from "../server/api/mcpReceiptWidget.js";
import { downloadReceiptEmblem } from "../server/api/match-receipts/_emblemProcessor.js";
import { getMcpProtectedResourceMetadata } from "../server/api/oauthProtectedResource.js";
import { getThermalReceiptLayout } from "../shared/lib/thermalReceipt.js";

const TEST_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64",
);
const VALID_RECEIPT_ARGUMENTS = {
  homeTeam: "A팀",
  awayTeam: "B팀",
  homeScore: 82,
  awayScore: 76,
  playedOn: "2026-08-22",
  playedTime: "20:30",
  venue: "광명시민체육관",
  format: "5v5",
  style: "thermal",
  preset: "story",
  locale: "ko",
};

function rpcRequest(method, params, id, headers = {}) {
  return new Request("https://boxtier.kr/mcp", {
    method: "POST",
    headers: {
      "accept": "application/json, text/event-stream",
      "content-type": "application/json",
      ...headers,
    },
    body: JSON.stringify({ jsonrpc: "2.0", method, ...(params ? { params } : {}), id }),
  });
}

async function rpc(handler, method, params, id, headers = {}) {
  const response = await handler.fetch(rpcRequest(method, params, id, headers));
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
  const handler = createBoxtierMcpHandler({
    renderPng: async () => TEST_PNG,
    widgetDomain: "https://boxtier.kr",
  });
  const initialized = await rpc(handler, "initialize", {
    protocolVersion: "2025-06-18",
    capabilities: {},
    clientInfo: { name: "boxtier-test", version: "1.0.0" },
  }, 1);
  assert.equal(initialized.result.serverInfo.name, "boxtier");

  const listed = await rpc(handler, "tools/list", {}, 2);
  const tool = listed.result.tools.find((candidate) => candidate.name === "create_basketball_receipt");
  assert.ok(tool);
  assert.match(tool.description, /박스티어/);
  assert.equal(tool.annotations.readOnlyHint, false);
  assert.equal(tool.annotations.idempotentHint, false);
  assert.equal(tool._meta.ui.resourceUri, MCP_RECEIPT_WIDGET_URI);
  assert.equal(tool._meta["openai/outputTemplate"], MCP_RECEIPT_WIDGET_URI);
  assert.deepEqual(tool._meta["openai/fileParams"], ["homeEmblemFile", "awayEmblemFile"]);
  assert.deepEqual(tool._meta.securitySchemes, [{ type: "noauth" }]);
  assert.ok(tool.inputSchema.properties.homeEmblem);
  assert.ok(tool.inputSchema.properties.awayEmblem);
  assert.ok(tool.inputSchema.properties.homeEmblem.properties.imageBase64);
  assert.deepEqual(tool.inputSchema.properties.homeEmblem.properties.mimeType.enum, [
    "image/jpeg", "image/png", "image/webp",
  ]);
  assert.deepEqual(tool.inputSchema.properties.debugBase64, {
    type: "boolean",
    default: false,
    description: "개발 확인용. true이면 생성된 PNG의 base64 문자열을 structuredContent에도 포함한다.",
  });
  assert.equal(tool.inputSchema.required.includes("debugBase64"), false);
  assert.ok(tool.outputSchema);
  const renderedOutput = tool.outputSchema.oneOf.find((schema) => schema.properties?.status?.const === "rendered");
  assert.ok(renderedOutput);
  for (const field of ["status", "mimeType", "preset", "style", "byteLength", "width", "height", "sha256", "imageAttached"]) {
    assert.equal(renderedOutput.required.includes(field), true);
  }
  assert.equal(renderedOutput.properties.base64.type, "string");
  assert.equal(renderedOutput.required.includes("base64"), false);
  assert.equal(tool.inputSchema.properties.homeEmblem.additionalProperties, false);
  for (const field of ["homeEmblemFile", "awayEmblemFile"]) {
    assert.ok(tool.inputSchema.properties[field]);
    assert.deepEqual(tool.inputSchema.properties[field].required.sort(), ["download_url", "file_id"]);
    assert.deepEqual(Object.keys(tool.inputSchema.properties[field].properties).sort(), [
      "download_url", "file_id", "file_name", "mime_type",
    ]);
  }
  assert.deepEqual(tool.inputSchema.required.sort(), [
    "awayScore", "awayTeam", "format", "homeScore", "homeTeam", "playedOn", "venue",
  ].sort());

  assert.deepEqual(listed.result.tools.map((candidate) => candidate.name).sort(), [
    "create_basketball_receipt", "fetch", "search",
  ]);

  const resource = await rpc(handler, "resources/read", { uri: MCP_RECEIPT_WIDGET_URI }, 21);
  assert.equal(resource.result.contents[0].mimeType, "text/html;profile=mcp-app");
  assert.equal(MCP_RECEIPT_WIDGET_URI, "ui://boxtier/basketball-receipt-v3.html");
  assert.equal(resource.result.contents[0]._meta["openai/widgetDomain"], "https://boxtier.kr");
  assert.match(resource.result.contents[0].text, /ui\/notifications\/tool-result/);
  assert.match(resource.result.contents[0].text, /toolResponseMetadata/);
  assert.match(resource.result.contents[0].text, /addEventListener\("openai:set_globals"/);
  assert.match(resource.result.contents[0].text, /event\.detail\?\.globals \?\? event\.detail/);
  assert.match(resource.result.contents[0].text, /metadata\?\.\["boxtier\/image"\]/);
  assert.match(resource.result.contents[0].text, />PNG 다운로드<\/a>/);
  assert.match(resource.result.contents[0].text, /download="boxtier-basketball-receipt\.png"/);
  assert.match(resource.result.contents[0].text, /new Blob\(\[bytes\], \{ type: "image\/png" \}\)/);
  assert.match(resource.result.contents[0].text, /URL\.createObjectURL\(receiptBlob\)/);
  assert.match(resource.result.contents[0].text, /navigator\.share\(\{ files: \[receiptFile\]/);
  await handler.close();
});

test("owner 계정만 영수증 일일 한도를 건너뛴다", async () => {
  let quotaCalls = 0;
  const handler = createBoxtierMcpHandler({
    authenticate: async () => ({ profileId: "owner-profile" }),
    getActorAdminLevel: async () => 100,
    consumeGenerationQuota: async () => {
      quotaCalls += 1;
      return false;
    },
    renderPng: async () => TEST_PNG,
  });
  const called = await rpc(handler, "tools/call", {
    name: "create_basketball_receipt",
    arguments: VALID_RECEIPT_ARGUMENTS,
  }, 22, { authorization: "Bearer owner-access-token-1234" });

  assert.equal(called.result.isError, undefined, JSON.stringify(called.result));
  assert.equal(quotaCalls, 0);
  await handler.close();
});

test("일반 로그인 사용자는 기존 영수증 일일 한도를 사용한다", async () => {
  let quotaCalls = 0;
  const handler = createBoxtierMcpHandler({
    authenticate: async () => ({ profileId: "regular-profile" }),
    getActorAdminLevel: async () => 0,
    consumeGenerationQuota: async () => {
      quotaCalls += 1;
      return true;
    },
    renderPng: async () => TEST_PNG,
  });
  const called = await rpc(handler, "tools/call", {
    name: "create_basketball_receipt",
    arguments: VALID_RECEIPT_ARGUMENTS,
  }, 23, { authorization: "Bearer regular-access-token-1234" });

  assert.equal(called.result.isError, undefined, JSON.stringify(called.result));
  assert.equal(quotaCalls, 1);
  await handler.close();
});

test("MCP 보호 리소스 메타데이터가 Supabase OAuth 서버를 선언한다", () => {
  const previousAppUrl = process.env.VITE_PUBLIC_APP_URL;
  const previousSupabaseUrl = process.env.SUPABASE_URL;
  process.env.VITE_PUBLIC_APP_URL = "https://boxtier.kr";
  process.env.SUPABASE_URL = "https://example.supabase.co";
  try {
    assert.deepEqual(getMcpProtectedResourceMetadata(), {
      resource: "https://boxtier.kr/mcp",
      authorization_servers: ["https://example.supabase.co/auth/v1"],
      scopes_supported: ["profile"],
      bearer_methods_supported: ["header"],
    });
  } finally {
    if (previousAppUrl === undefined) delete process.env.VITE_PUBLIC_APP_URL;
    else process.env.VITE_PUBLIC_APP_URL = previousAppUrl;
    if (previousSupabaseUrl === undefined) delete process.env.SUPABASE_URL;
    else process.env.SUPABASE_URL = previousSupabaseUrl;
  }
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
  assert.equal(called.result.content.length, 1);
  assert.equal(called.result.content[0].type, "image");
  assert.equal(called.result.content[0].mimeType, "image/png");
  assert.equal(called.result.content[0].data, TEST_PNG.toString("base64"));
  assert.doesNotMatch(called.result.content[0].data, /^data:/u);
  assert.deepEqual(called.result._meta["boxtier/image"], {
    data: TEST_PNG.toString("base64"),
    mimeType: "image/png",
    filename: "boxtier-basketball-receipt.png",
  });
  assert.deepEqual(called.result.structuredContent, {
    status: "rendered",
    mimeType: "image/png",
    preset: "story",
    style: "thermal",
    byteLength: TEST_PNG.length,
    width: 1,
    height: 1,
    sha256: createHash("sha256").update(TEST_PNG).digest("hex"),
    imageAttached: true,
  });
  assert.equal("base64" in called.result.structuredContent, false);
  assert.equal(renderCall.preset, "story");
  assert.equal(renderCall.draft.receiptStyle, "classic-thermal");
  assert.equal(quotaRequest instanceof Request, true);
  await handler.close();
});

test("MCP 디버그 모드는 실제 PNG raw Base64와 복원 가능한 바이트를 반환한다", async () => {
  const handler = createBoxtierMcpHandler({
    consumeGenerationQuota: async () => true,
  });
  const called = await rpc(handler, "tools/call", {
    name: "create_basketball_receipt",
    arguments: {
      homeTeam: "A팀",
      awayTeam: "B팀",
      homeScore: 82,
      awayScore: 76,
      playedOn: "2026-08-22",
      playedTime: "20:30",
      venue: "광명시민체육관",
      format: "5v5",
      style: "thermal",
      preset: "story",
      locale: "ko",
      debugBase64: true,
    },
  }, 4);

  assert.equal(called.result.isError, undefined, JSON.stringify(called.result));
  const image = called.result.content[0];
  const metadata = called.result.structuredContent;
  assert.equal(image.type, "image");
  assert.equal(image.mimeType, "image/png");
  assert.ok(metadata.byteLength > 0);
  assert.equal(metadata.width > 0, true);
  assert.equal(metadata.height > 0, true);
  assert.equal(metadata.imageAttached, true);
  assert.equal(metadata.base64, image.data);
  assert.equal(called.result.structuredContent.base64, image.data);
  assert.match(image.data, /^iVBORw0KG/u);
  assert.doesNotMatch(image.data, /^data:/u);
  const restored = Buffer.from(image.data, "base64");
  assert.equal(restored.length, metadata.byteLength);
  assert.equal(createHash("sha256").update(restored).digest("hex"), metadata.sha256);
  assert.equal(restored.subarray(0, 8).toString("hex"), "89504e470d0a1a0a");
  await handler.close();
});

for (const [label, rendered] of [
  ["빈 Buffer", Buffer.alloc(0)],
  ["PNG가 아닌 Buffer", Buffer.from("not-a-png")],
  ["잘린 PNG", TEST_PNG.subarray(0, TEST_PNG.length - 8)],
  ["Buffer가 아닌 PNG 바이트", new Uint8Array(TEST_PNG)],
]) {
  test(`MCP는 ${label}를 성공으로 반환하지 않는다`, async () => {
    const handler = createBoxtierMcpHandler({
      consumeGenerationQuota: async () => true,
      renderPng: async () => rendered,
    });
    const called = await rpc(handler, "tools/call", {
      name: "create_basketball_receipt",
      arguments: VALID_RECEIPT_ARGUMENTS,
    }, 41);

    assert.equal(called.result.isError, true);
    assert.equal(called.result.structuredContent.status, "error");
    assert.match(called.result.content[0].text, /PNG 생성에 실패/);
    await handler.close();
  });
}

test("MCP 호출은 누락 입력을 구조화해 반환하고 한도를 소비하지 않는다", async () => {
  let quotaCalls = 0;
  let renders = 0;
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
    arguments: { homeTeam: "SEOUL HOOPERS" },
  }, 30);

  assert.equal(called.result.isError, true);
  assert.equal(called.result.structuredContent.status, "error");
  assert.deepEqual(
    called.result.structuredContent.issues.map((issue) => issue.field).sort(),
    ["awayScore", "awayTeam", "format", "homeScore", "playedOn", "venue"].sort(),
  );
  assert.doesNotMatch(called.result.content[0].text, /Input validation error/);
  assert.equal(quotaCalls, 0);
  assert.equal(renders, 0);
  await handler.close();
});

test("MCP 호출은 첨부 원본을 메모리에서 정규화해 렌더러에 전달한다", async () => {
  let renderCall = null;
  const { default: sharp } = await import("sharp");
  const sourcePng = await sharp({
    create: {
      width: 640,
      height: 320,
      channels: 4,
      background: { r: 23, g: 94, b: 180, alpha: 1 },
    },
  }).png().toBuffer();
  const emblemBase64 = sourcePng.toString("base64");
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
      homeEmblem: { imageBase64: emblemBase64, mimeType: "image/png" },
      awayEmblem: { imageBase64: emblemBase64 },
      homeScore: 81,
      awayScore: 77,
      playedOn: "2026-08-21",
      venue: "RIVER COURT",
      format: "5v5",
    },
  }, 31);

  assert.equal(called.result.isError, undefined, JSON.stringify(called.result));
  for (const emblem of [renderCall.emblems.home, renderCall.emblems.away]) {
    assert.equal(emblem.mimeType, "image/webp");
    assert.notEqual(emblem.imageBase64, emblemBase64);
    const normalized = Buffer.from(emblem.imageBase64, "base64");
    const metadata = await sharp(normalized).metadata();
    assert.equal(metadata.format, "webp");
    assert.equal(metadata.width, 320);
    assert.equal(metadata.height, 320);
    assert.ok(normalized.length <= 96 * 1024);
    const { data, info } = await sharp(normalized).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    assert.equal(data[3], 0);
    assert.ok(data[((160 * info.width + 160) * info.channels) + 3] > 0);
  }
  await handler.close();
});

test("엠블럼 임시 URL은 HTTPS와 공인 주소만 허용한다", async () => {
  await assert.rejects(
    () => downloadReceiptEmblem("http://example.com/emblem.png", "homeEmblem"),
    (error) => error?.field === "homeEmblem" && error?.code === "emblem_download_url_invalid",
  );
  await assert.rejects(
    () => downloadReceiptEmblem("https://127.0.0.1/emblem.png", "awayEmblem"),
    (error) => error?.field === "awayEmblem" && error?.code === "emblem_download_failed",
  );
});

test("ChatGPT 첨부 파일 파라미터를 메모리 엠블럼 처리기로 전달한다", async () => {
  let preparedInput = null;
  let renderCall = null;
  const handler = createBoxtierMcpHandler({
    consumeGenerationQuota: async () => true,
    prepareEmblems: async (emblems) => {
      preparedInput = emblems;
      return { home: { imageBase64: "normalized", mimeType: "image/webp" }, away: null };
    },
    renderPng: async (input) => {
      renderCall = input;
      return TEST_PNG;
    },
  });
  const called = await rpc(handler, "tools/call", {
    name: "create_basketball_receipt",
    arguments: {
      ...VALID_RECEIPT_ARGUMENTS,
      homeEmblemFile: {
        download_url: "https://files.example.test/emblem.png?token=temporary",
        file_id: "file_home_emblem",
        mime_type: "image/png",
        file_name: "home.png",
      },
    },
  }, 35);

  assert.equal(called.result.isError, undefined, JSON.stringify(called.result));
  assert.deepEqual(preparedInput.home, {
    downloadUrl: "https://files.example.test/emblem.png?token=temporary",
    fileId: "file_home_emblem",
    mimeType: "image/png",
    fileName: "home.png",
  });
  assert.deepEqual(renderCall.emblems.home, { imageBase64: "normalized", mimeType: "image/webp" });
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
  const withInvalidImage = await rpc(handler, "tools/call", {
    name: "create_basketball_receipt",
    arguments: {
      ...baseArguments,
      homeEmblem: { imageBase64: Buffer.from("not-an-image").toString("base64") },
    },
  }, 34);

  assert.equal(withUrl.result.isError, true);
  assert.equal(withDataUrl.result.isError, true);
  assert.equal(withInvalidImage.result.isError, true);
  assert.deepEqual(withInvalidImage.result.structuredContent.issues, [{
    field: "homeEmblem",
    code: "emblem_image_invalid",
  }]);
  assert.equal(renders, 0);
  assert.equal(quotaCalls, 1);
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

test("MCP 실제 renderer가 중립 엠블럼과 선택 영역 팔레트를 적용한 Story PNG를 반환한다", async () => {
  const { default: sharp } = await import("sharp");
  const handler = createBoxtierMcpHandler({ consumeGenerationQuota: async () => true });
  const called = await rpc(handler, "tools/call", {
    name: "create_basketball_receipt",
    arguments: {
      style: "thermal",
      preset: "story",
      homeTeam: "A팀",
      awayTeam: "B팀",
      homeScore: 82,
      awayScore: 76,
      playedOn: "2026-08-22",
      playedTime: "20:30",
      venue: "광명시민체육관",
      format: "5v5",
      locale: "ko",
    },
  }, 6);

  assert.equal(called.result.isError, undefined, JSON.stringify(called.result));
  const png = Buffer.from(called.result.content[0].data, "base64");
  assert.deepEqual(png.subarray(0, 8), Buffer.from("89504e470d0a1a0a", "hex"));
  const layout = getThermalReceiptLayout({ hasPhoto: false, hasPeriods: false, hasComment: false });
  const metadata = await sharp(png).metadata();
  assert.equal(metadata.width, layout.paper.width);
  assert.equal(metadata.height, layout.paper.height);
  assert.equal(called.result.structuredContent.width, metadata.width);
  assert.equal(called.result.structuredContent.height, metadata.height);
  assert.equal(called.result.structuredContent.byteLength, png.length);
  assert.equal(called.result.structuredContent.sha256, createHash("sha256").update(png).digest("hex"));
  const { data: pixels, info } = await sharp(png).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  assert.equal(info.channels, 3);
  const emblemLevels = new Set([24, 88, 152, 224]);
  const bodyLevels = new Set();
  const emblemY = layout.teams.y + 82 - layout.paper.y;
  const emblemCenters = [
    layout.teams.x + 126 - layout.paper.x,
    layout.teams.x + layout.teams.width - 126 - layout.paper.x,
  ];
  const emblemCounts = emblemCenters.map(() => ({ dark: 0, light: 0 }));
  for (let index = 0; index < pixels.length; index += 3) {
    const pixelIndex = index / 3;
    const x = pixelIndex % info.width;
    const y = Math.floor(pixelIndex / info.width);
    const emblemIndex = emblemCenters.findIndex((centerX) => (
      (x - centerX) ** 2 + (y - emblemY) ** 2 <= 69 ** 2
    ));
    assert.equal(pixels[index], pixels[index + 1]);
    assert.equal(pixels[index], pixels[index + 2]);
    if (emblemIndex >= 0) {
      assert.equal(emblemLevels.has(pixels[index]), true);
      if (pixels[index] < 224) emblemCounts[emblemIndex].dark += 1;
      if (pixels[index] === 224) emblemCounts[emblemIndex].light += 1;
    } else {
      bodyLevels.add(pixels[index]);
    }
  }
  for (const counts of emblemCounts) {
    assert.ok(counts.dark > 0, "중립 엠블럼 선화가 보여야 한다");
    assert.ok(counts.light > 0, "중립 엠블럼이 검은 원으로 뭉개지면 안 된다");
  }
  assert.ok(bodyLevels.size > 16, "종이와 본문의 연속 회색 농도가 보존되어야 한다");
  await handler.close();
});

test("MCP 실제 renderer가 Feed PNG 원본과 검증 메타데이터를 함께 반환한다", async () => {
  const { default: sharp } = await import("sharp");
  const handler = createBoxtierMcpHandler({ consumeGenerationQuota: async () => true });
  const called = await rpc(handler, "tools/call", {
    name: "create_basketball_receipt",
    arguments: {
      ...VALID_RECEIPT_ARGUMENTS,
      preset: "feed",
    },
  }, 7);

  assert.equal(called.result.isError, undefined, JSON.stringify(called.result));
  assert.equal(called.result.content.length, 1);
  assert.equal(called.result.content[0].type, "image");
  assert.equal(called.result.content[0].mimeType, "image/png");
  const png = Buffer.from(called.result.content[0].data, "base64");
  const metadata = await sharp(png).metadata();
  assert.equal(metadata.width, 1080);
  assert.equal(metadata.height, 1350);
  assert.equal(called.result.structuredContent.preset, "feed");
  assert.equal(called.result.structuredContent.width, metadata.width);
  assert.equal(called.result.structuredContent.height, metadata.height);
  assert.equal(called.result.structuredContent.byteLength, png.length);
  assert.equal(called.result.structuredContent.sha256, createHash("sha256").update(png).digest("hex"));
  assert.equal(called.result.structuredContent.imageAttached, true);
  await handler.close();
});
