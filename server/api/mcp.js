import { createMcpHandler, McpServer } from "@modelcontextprotocol/server";
import * as z from "zod/v4";
import {
  parseExternalReceiptInput,
  PREPARED_EMBLEM_MAX_BASE64_LENGTH,
} from "./match-receipts/_createInput.js";
import {
  MATCH_RECEIPT_RENDER_PRESETS,
  renderMatchReceiptPng,
} from "./match-receipts/_pngRenderer.js";
import { MATCH_RECEIPT_STYLES } from "../../shared/lib/thermalReceipt.js";
import { consumeMcpReceiptGenerationQuota } from "./mcpQuota.js";
import {
  MCP_RECEIPT_WIDGET_HTML,
  MCP_RECEIPT_WIDGET_MIME_TYPE,
  MCP_RECEIPT_WIDGET_URI,
} from "./mcpReceiptWidget.js";

const preparedEmblemSchema = z.object({
  imageBase64: z.string().min(1).max(PREPARED_EMBLEM_MAX_BASE64_LENGTH)
    .describe("AI가 투명 정사각형 WebP로 전처리한 엠블럼의 raw Base64. data: 접두사 없이 최대 320x320px, 96KB."),
}).strict().describe("저장하지 않고 이번 PNG 합성에만 사용하는 처리 완료 엠블럼.");

const receiptInputSchema = z.object({
  style: z.enum(["thermal", "score"]).default("thermal")
    .describe("영수증 스타일. 감열지 영수증은 thermal, 스코어 포스터는 score."),
  preset: z.enum(["story", "feed"]).default("story")
    .describe("PNG 비율. story는 1080x1920, feed는 1080x1350."),
  homeTeam: z.string().min(1).max(24).describe("홈팀 이름."),
  awayTeam: z.string().min(1).max(24).describe("원정팀 이름."),
  homeEmblem: preparedEmblemSchema.optional()
    .describe("선택 홈 엠블럼. 원본 비율과 글자를 보존해 전처리한 WebP를 중앙 정렬하며, thermal은 최종 4단계 회색조로 변환한다."),
  awayEmblem: preparedEmblemSchema.optional()
    .describe("선택 원정 엠블럼. 원본 비율과 글자를 보존해 전처리한 WebP를 중앙 정렬하며, thermal은 최종 4단계 회색조로 변환한다."),
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
  debugBase64: z.boolean().default(false)
    .describe("개발 확인용. true이면 생성된 PNG의 base64 문자열을 structured/text 결과에도 포함한다."),
}).strict();

// Keep required fields visible in tools/list, but let the handler return a
// structured tool error instead of the SDK's plain input-validation string.
const receiptToolInputSchema = {
  "~standard": {
    ...receiptInputSchema["~standard"],
    validate: (value) => ({ value }),
  },
};

function toInputIssues(error) {
  return error.issues.map((issue) => ({
    field: issue.path.join(".") || "input",
    code: issue.code,
    message: issue.message,
  }));
}

function toolError(message, issues = []) {
  return {
    isError: true,
    structuredContent: { status: "error", issues },
    content: [{
      type: "text",
      text: issues.length > 0 ? `${message} ${JSON.stringify(issues)}` : message,
    }],
  };
}

export function createBoxtierMcpHandler({
  renderPng = renderMatchReceiptPng,
  consumeGenerationQuota = consumeMcpReceiptGenerationQuota,
} = {}) {
  return createMcpHandler((context) => {
    const server = new McpServer({ name: "boxtier-receipt", version: "1.0.0" });

    server.registerResource(
      "boxtier-basketball-receipt",
      MCP_RECEIPT_WIDGET_URI,
      {
        title: "BoxTier 농구 영수증",
        description: "생성된 농구 영수증 PNG를 대화 안에 표시한다.",
        mimeType: MCP_RECEIPT_WIDGET_MIME_TYPE,
      },
      async (uri) => ({
        contents: [{
          uri: uri.href,
          mimeType: MCP_RECEIPT_WIDGET_MIME_TYPE,
          text: MCP_RECEIPT_WIDGET_HTML,
          _meta: {
            ui: { prefersBorder: true, csp: { connectDomains: [], resourceDomains: [] } },
            "openai/widgetPrefersBorder": true,
            "openai/widgetCSP": { connect_domains: [], resource_domains: [] },
          },
        }],
      }),
    );

    server.registerTool(
      "create_basketball_receipt",
      {
        title: "BoxTier 농구 영수증 PNG 만들기",
        description: "박스티어(BoxTier) 스타일의 농구 경기 영수증 PNG를 만든다. 사용자가 ‘박스티어로 영수증 만들어줘’, 농구 감열지 영수증, basketball game receipt, score receipt를 요청했고 팀명·최종 점수·경기 날짜·장소·경기 형식을 모두 실제 값으로 제공했을 때만 사용한다. 첨부 엠블럼을 사용할 때는 원본 비율과 글자를 보존한 투명 정사각형 WebP로 전처리해 선택 입력으로 전달한다. 누락값을 추측하지 말고 먼저 사용자에게 물어본다. 농구 외 경기, 허위 경기 기록, 상거래 영수증에는 사용하지 않는다.",
        inputSchema: receiptToolInputSchema,
        annotations: {
          readOnlyHint: false,
          destructiveHint: false,
          idempotentHint: false,
          openWorldHint: false,
        },
        _meta: {
          ui: { resourceUri: MCP_RECEIPT_WIDGET_URI },
          "openai/outputTemplate": MCP_RECEIPT_WIDGET_URI,
          "openai/toolInvocation/invoking": "농구 영수증 PNG 렌더링 중",
        },
      },
      async (rawInput) => {
        const validated = receiptInputSchema.safeParse(rawInput);
        if (!validated.success) {
          return toolError("필수 입력값이 없거나 형식이 올바르지 않다.", toInputIssues(validated.error));
        }

        const {
          preset = MATCH_RECEIPT_RENDER_PRESETS.story,
          style = "thermal",
          debugBase64 = false,
          ...input
        } = validated.data;
        const parsed = parseExternalReceiptInput({
          ...input,
          style: MATCH_RECEIPT_STYLES[style],
        }, { allowPreparedEmblems: true });
        if (parsed.issues.length > 0) {
          return toolError("영수증 입력값이 올바르지 않다.", parsed.issues);
        }

        try {
          const allowed = await consumeGenerationQuota(context.requestInfo);
          if (!allowed) return toolError("최근 24시간 PNG 생성 한도 10회를 초과했다.");
        } catch (error) {
          console.error("[mcp] receipt quota check failed", error);
          return toolError("영수증 생성 한도를 확인할 수 없다.");
        }

        try {
          const png = await renderPng({
            draft: parsed.draft,
            emblems: parsed.emblems,
            preset,
          });
          const pngBuffer = Buffer.isBuffer(png) ? png : Buffer.from(png);
          const imageData = pngBuffer.toString("base64");
          const metadata = {
            status: "rendered",
            mimeType: "image/png",
            preset,
            style,
            byteLength: pngBuffer.length,
            ...(debugBase64 ? { base64: imageData } : {}),
          };
          return {
            structuredContent: metadata,
            content: [
              { type: "image", data: imageData, mimeType: "image/png" },
              { type: "text", text: JSON.stringify(metadata) },
            ],
            _meta: { "boxtier/image": { data: imageData, mimeType: "image/png" } },
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
