import assert from "node:assert/strict";
import test from "node:test";
import { createBoxtierMcpHandler } from "../server/api/mcp.js";
import { searchPublicMatchingRoomCards } from "../server/lib/publicMatchingRooms.js";

function rpcRequest(method, params, id) {
  return new Request("https://boxtier.kr/mcp", {
    method: "POST",
    headers: { accept: "application/json, text/event-stream", "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", method, params, id }),
  });
}

async function rpc(handler, method, params, id) {
  const response = await handler.fetch(rpcRequest(method, params, id));
  const body = await response.text();
  const data = response.headers.get("content-type")?.includes("text/event-stream")
    ? body.split("\n").find((line) => line.startsWith("data: "))?.slice(6)
    : body;
  return JSON.parse(data);
}

const CARDS = [
  { id: "seongsu-3v3", title: "성수 저녁 3x3", region: "성수", mode: "3v3", scheduledDate: "2026-08-23", scheduledAt: "2026-08-23 19:00", visibility: "public", status: "open" },
  { id: "jamsil-3v3", title: "잠실 저녁 3x3", region: "잠실", mode: "3v3", scheduledDate: "2026-08-23", scheduledAt: "2026-08-23 19:00", visibility: "public", status: "open" },
  { id: "jamsil-5v5", title: "잠실 주말 팀전", region: "잠실", mode: "5v5", scheduledDate: "2026-08-24", scheduledAt: "2026-08-24 15:00", teamOnly: true, visibility: "public", status: "open" },
  { id: "private-seongsu", title: "성수 비공개 3x3", region: "성수", mode: "3v3", scheduledDate: "2026-08-23", visibility: "private", status: "open" },
  { id: "closed-seongsu", title: "성수 마감 3x3", region: "성수", mode: "3v3", scheduledDate: "2026-08-23", visibility: "public", status: "closed" },
];

test("지역·방식·날짜 조건으로 공개 매칭방을 고른다", () => {
  const result = searchPublicMatchingRoomCards(CARDS, "오늘 성수에서 3대3 농구할 곳 찾아줘", {
    now: new Date("2026-08-23T03:00:00.000Z"),
  });
  assert.deepEqual(result.map((card) => card.id), ["seongsu-3v3"]);
});

test("내일 팀 상대 모집 표현도 공개 팀방으로 정규화한다", () => {
  const result = searchPublicMatchingRoomCards(CARDS, "내일 잠실에서 5대5로 붙을 상대 팀 모집방 찾아줘", {
    now: new Date("2026-08-23T03:00:00.000Z"),
  });
  assert.deepEqual(result.map((card) => card.id), ["jamsil-5v5"]);
});

test("MCP search와 fetch는 Apps SDK 표준 JSON 계약을 반환한다", async () => {
  const handler = createBoxtierMcpHandler({
    renderPng: async () => Buffer.alloc(0),
    searchRooms: async (query) => ({ results: [{ id: "seongsu-3v3", title: query, url: "https://boxtier.kr/app/recruiting?post=seongsu-3v3" }] }),
    fetchRoom: async (id) => ({ id, title: "성수 저녁 3x3", text: "지역: 성수", url: `https://boxtier.kr/app/recruiting?post=${id}`, metadata: { mode: "3v3" } }),
  });
  const listed = await rpc(handler, "tools/list", {}, 1);
  const tools = new Map(listed.result.tools.map((tool) => [tool.name, tool]));
  assert.equal(tools.get("search").annotations.openWorldHint, true);
  assert.deepEqual(tools.get("search").inputSchema.required, ["query"]);
  assert.deepEqual(tools.get("fetch").inputSchema.required, ["id"]);

  const searched = await rpc(handler, "tools/call", { name: "search", arguments: { query: "성수 3대3" } }, 2);
  assert.deepEqual(JSON.parse(searched.result.content[0].text).results[0].id, "seongsu-3v3");
  const fetched = await rpc(handler, "tools/call", { name: "fetch", arguments: { id: "seongsu-3v3" } }, 3);
  assert.equal(JSON.parse(fetched.result.content[0].text).metadata.mode, "3v3");
  await handler.close();
});
