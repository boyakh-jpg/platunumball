import { createMcpHandler, McpServer } from "@modelcontextprotocol/server";
import * as z from "zod/v4";
import { parseExternalReceiptInput } from "./match-receipts/_createInput.js";
import {
  MATCH_RECEIPT_RENDER_PRESETS,
  renderMatchReceiptPng,
} from "./match-receipts/_pngRenderer.js";
import { MATCH_RECEIPT_STYLES } from "../../shared/lib/thermalReceipt.js";

const receiptInputSchema = z.object({
  style: z.enum(["thermal", "score"]).default("thermal")
    .describe("영수증 스타일. 감열지 영수증은 thermal, 스코어 포스터는 score."),
  preset: z.enum(["story", "feed"]).default("story")
    .describe("PNG 비율. story는 1080x1920, feed는 1080x1350."),
  homeTeam: z.string().min(1).max(24).describe("홈팀 이름."),
  awayTeam: z.string().min(1).max(24).describe("원정팀 이름."),
  homeScore: z.number().int().min(0).max(999).describe("홈팀 최종 점수."),
  awayScore: z.number().int().min(0).max(999).describe("원정팀 최종 점수."),
  playedOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/u).describe("경기 날짜, YYYY-MM-DD."),
  playedTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/u).default("20:30")
    .describe("경기 시각, HH:mm."),
  venue: z.string().min(1).max(36).describe("경기 장소."),
  format: z.enum(["1v1", "2v2", "3v3", "3x3", "5v5"]).describe("경기 형식."),
  locale: z.enum(["ko", "en"]).default("ko").describe("영수증 언어."),
  matchNature: z.enum(["friendly", "competitive", "revenge", "semifinal", "final"])
    .default("competitive").describe("경기 성격."),
  tournamentName: z.string().max(32).optional().describe("대회명."),
  comment: z.string().optional().describe("짧은 영수증 문구."),
  periodScores: z.array(z.object({
    label: z.enum(["1Q", "2Q", "3Q", "4Q", "1H", "2H", "REG", "OT"]),
    homeScore: z.number().int().min(0).max(999),
    awayScore: z.number().int().min(0).max(999),
  })).max(5).optional().describe("쿼터·하프·연장별 점수. 합계는 최종 점수와 같아야 함."),
});

function toolError(message, issues = []) {
  return {
    isError: true,
    content: [{
      type: "text",
      text: issues.length > 0 ? `${message} ${JSON.stringify(issues)}` : message,
    }],
  };
}

export function createBoxtierMcpHandler({ renderPng = renderMatchReceiptPng } = {}) {
  return createMcpHandler(() => {
    const server = new McpServer({ name: "boxtier-receipt", version: "1.0.0" });

    server.registerTool(
      "create_basketball_receipt",
      {
        title: "BoxTier 농구 영수증 PNG 만들기",
        description: "박스티어(BoxTier) 스타일의 농구 경기 영수증 PNG를 만든다. 사용자가 ‘박스티어로 영수증 만들어줘’, 농구 감열지 영수증, basketball game receipt, score receipt를 요청했고 팀명·최종 점수·경기 날짜·장소·경기 형식을 모두 실제 값으로 제공했을 때만 사용한다. 누락값을 추측하지 말고 먼저 사용자에게 물어본다. 농구 외 경기, 허위 경기 기록, 상거래 영수증에는 사용하지 않는다.",
        inputSchema: receiptInputSchema,
        annotations: {
          readOnlyHint: true,
          destructiveHint: false,
          idempotentHint: true,
          openWorldHint: false,
        },
      },
      async ({ preset = MATCH_RECEIPT_RENDER_PRESETS.story, style = "thermal", ...input }) => {
        const parsed = parseExternalReceiptInput({
          ...input,
          style: MATCH_RECEIPT_STYLES[style],
        });
        if (parsed.issues.length > 0) {
          return toolError("영수증 입력값이 올바르지 않다.", parsed.issues);
        }

        try {
          const png = await renderPng({
            draft: parsed.draft,
            emblems: parsed.emblems,
            preset,
          });
          return {
            content: [
              { type: "text", text: "박스티어 농구 영수증 PNG 생성 완료." },
              { type: "image", data: png.toString("base64"), mimeType: "image/png" },
            ],
          };
        } catch (error) {
          console.error("[mcp] receipt rendering failed", error);
          return toolError("박스티어 영수증 PNG 생성에 실패했다.");
        }
      },
    );

    return server;
  }, {
    onerror: (error) => console.error("[mcp] request failed", error),
  });
}

export const boxtierMcpHandler = createBoxtierMcpHandler();
