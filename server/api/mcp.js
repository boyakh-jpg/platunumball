import { createMcpHandler, McpServer } from "@modelcontextprotocol/server";
import * as z from "zod/v4";
import {
  parseExternalReceiptInput,
  MCP_RECEIPT_EMBLEM_MAX_BASE64_LENGTH,
} from "./match-receipts/_createInput.js";
import { prepareReceiptEmblems } from "./match-receipts/_emblemProcessor.js";
import {
  MATCH_RECEIPT_RENDER_PRESETS,
  renderMatchReceiptPng,
} from "./match-receipts/_pngRenderer.js";
import { MATCH_RECEIPT_STYLES } from "../../shared/lib/thermalReceipt.js";
import { consumeMcpReceiptGenerationQuota } from "./mcpQuota.js";
import { getConfiguredPublicAppUrl, getPublicAppWebUrl } from "./_publicAppUrl.js";
import { getAuthenticatedContext } from "./_supabaseAuth.js";
import { getAdminLevel } from "./_supabaseAdmin.js";
import { parseBearerAuthorization } from "./_requestSecurity.js";
import { inspectReceiptPng } from "./mcpReceiptImage.js";
import {
  MCP_RECEIPT_LEGACY_WIDGET_HTML,
  MCP_RECEIPT_LEGACY_WIDGET_URIS,
  MCP_RECEIPT_WIDGET_HTML,
  MCP_RECEIPT_WIDGET_MIME_TYPE,
  MCP_RECEIPT_WIDGET_URI,
} from "./mcpReceiptWidget.js";
import { createPublicReceiptDraft } from "./match-receipts/_publicDraft.js";
import { fetchPublicMatchingRoom, searchPublicMatchingRooms } from "../lib/publicMatchingRooms.js";
import { loadOwnCompactRecordPage } from "./records/list.js";

const receiptEmblemSchema = z.object({
  imageBase64: z.string().min(1).max(MCP_RECEIPT_EMBLEM_MAX_BASE64_LENGTH)
    .describe("사용자가 첨부한 JPG, PNG 또는 WebP 엠블럼의 raw Base64. data: 접두사 없이 전달한다."),
  mimeType: z.enum(["image/jpeg", "image/png", "image/webp"]).optional()
    .describe("첨부 이미지의 MIME 형식. 서버는 실제 이미지 바이트도 검증한다."),
}).strict().describe("저장하지 않고 서버 메모리에서 320x320 투명 WebP로 처리해 이번 PNG에만 사용하는 엠블럼. 원형 파일은 강제하지 않으며 투명 배경 정사각형 캔버스를 권장한다.");

const receiptEmblemFileSchema = z.object({
  download_url: z.string().url().describe("ChatGPT가 제공하는 임시 파일 다운로드 URL."),
  file_id: z.string().min(1).describe("ChatGPT 첨부파일 ID."),
  mime_type: z.string().optional().describe("첨부파일 MIME 형식."),
  file_name: z.string().optional().describe("첨부파일 이름."),
}).strict().describe("ChatGPT 대화에 첨부된 엠블럼 이미지 파일. 원형 파일은 강제하지 않으며 투명 배경 정사각형 캔버스를 권장한다.");

const receiptInputSchema = z.object({
  style: z.enum(["thermal", "score"]).default("thermal")
    .describe("영수증 스타일. 감열지 영수증은 thermal, 스코어 포스터는 score."),
  preset: z.enum(["story", "feed"]).default("story")
    .describe("PNG 출력 형식. thermal story는 종이 경계만 내보내며 찢긴 상·하단 바깥은 완전 투명하다. feed는 1080x1350 배경을 포함한다. score story는 1080x1920이다."),
  homeTeam: z.string().min(1).max(24).describe("홈팀 이름."),
  awayTeam: z.string().min(1).max(24).describe("원정팀 이름."),
  homeEmblem: receiptEmblemSchema.optional()
    .describe("선택 홈 엠블럼. 투명 배경 정사각형 캔버스에 실제 도안만 넣어 전달하는 것을 권장하며 원형 테두리·회색 원판을 미리 합성하지 않는다. 서버가 알파 전경의 실제 경계와 중심을 계산해 원형 안전영역 안에 비율 유지·자동 중앙 정렬하고, thermal은 전경만 4단계 회색조로 변환한다. 생략하면 중립 엠블럼을 사용한다."),
  awayEmblem: receiptEmblemSchema.optional()
    .describe("선택 원정 엠블럼. 투명 배경 정사각형 캔버스에 실제 도안만 넣어 전달하는 것을 권장하며 원형 테두리·회색 원판을 미리 합성하지 않는다. 서버가 알파 전경의 실제 경계와 중심을 계산해 원형 안전영역 안에 비율 유지·자동 중앙 정렬하고, thermal은 전경만 4단계 회색조로 변환한다. 생략하면 중립 엠블럼을 사용한다."),
  homeEmblemFile: receiptEmblemFileSchema.optional()
    .describe("ChatGPT에 첨부한 홈팀 엠블럼. 투명 배경 정사각형 캔버스를 권장하고 원형 테두리·회색 원판은 미리 넣지 않는다. 서버가 실제 알파 전경을 원형 안전영역에 자동 중앙 정렬한다. homeEmblem과 동시에 전달하지 않는다."),
  awayEmblemFile: receiptEmblemFileSchema.optional()
    .describe("ChatGPT에 첨부한 원정팀 엠블럼. 투명 배경 정사각형 캔버스를 권장하고 원형 테두리·회색 원판은 미리 넣지 않는다. 서버가 실제 알파 전경을 원형 안전영역에 자동 중앙 정렬한다. awayEmblem과 동시에 전달하지 않는다."),
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
    .describe("개발 확인용. true이면 생성된 PNG의 base64 문자열을 structuredContent에도 포함한다."),
}).strict();

const receiptIssueSchema = z.object({
  field: z.string(),
  code: z.string(),
  message: z.string().optional(),
}).passthrough();

const receiptOutputSchema = z.discriminatedUnion("status", [
  z.object({
    status: z.literal("rendered"),
    mimeType: z.literal("image/png"),
    preset: z.enum(["story", "feed"]),
    style: z.enum(["thermal", "score"]),
    byteLength: z.number().int().positive(),
    width: z.number().int().positive(),
    height: z.number().int().positive(),
    sha256: z.string().regex(/^[0-9a-f]{64}$/u),
    imageAttached: z.literal(true),
    publicCode: z.string().min(1),
    receiptPath: z.string().min(1),
    base64: z.string().optional(),
  }).strict(),
  z.object({
    status: z.literal("error"),
    issues: z.array(receiptIssueSchema),
  }).strict(),
]);

const MCP_OAUTH_SCOPES = ["profile"];
const PUBLIC_SECURITY_SCHEMES = [{ type: "noauth" }];
const OPTIONAL_AUTH_SECURITY_SCHEMES = [
  ...PUBLIC_SECURITY_SCHEMES,
  { type: "oauth2", scopes: MCP_OAUTH_SCOPES },
];
const REQUIRED_AUTH_SECURITY_SCHEMES = [{ type: "oauth2", scopes: MCP_OAUTH_SCOPES }];
const OWNER_ADMIN_LEVEL = 100;

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

function toolError(message, issues = [], meta = undefined) {
  return {
    isError: true,
    structuredContent: { status: "error", issues },
    content: [{
      type: "text",
      text: issues.length > 0 ? `${message} ${JSON.stringify(issues)}` : message,
    }],
    ...(meta ? { _meta: meta } : {}),
  };
}

function getResourceMetadataUrl(request, configuredDomain = "") {
  let origin = configuredDomain;
  if (!origin) {
    try {
      origin = new URL(request?.url ?? "").origin;
    } catch {
      origin = "";
    }
  }
  return origin ? `${origin}/.well-known/oauth-protected-resource` : "";
}

function authRequired(request, configuredDomain = "", options = {}) {
  const resourceMetadataUrl = getResourceMetadataUrl(request, configuredDomain);
  const errorPart = options.error
    ? `, error="${options.error}", error_description="${options.description || "Authentication failed."}"`
    : "";
  const challenge = `Bearer scope="${MCP_OAUTH_SCOPES.join(" ")}"${errorPart}${resourceMetadataUrl ? `, resource_metadata="${resourceMetadataUrl}"` : ""}`;
  return toolError(options.message || "BoxTier 로그인이 필요하다.", [], {
    "mcp/www_authenticate": [challenge],
  });
}

function getAuthenticationChallengeOptions(error) {
  return error?.message === "invalid_bearer_token"
    ? { error: "invalid_token", description: "The access token is invalid or expired." }
    : {};
}

function isAuthenticationError(error) {
  return error?.statusCode === 401
    || ["missing_bearer_token", "invalid_bearer_token"].includes(error?.message);
}

async function getOptionalAuthContext(request, authenticate) {
  const bearer = parseBearerAuthorization(request);
  if (bearer.error === "missing_bearer_token") return null;
  if (bearer.error) {
    const error = new Error(bearer.error);
    error.statusCode = 401;
    throw error;
  }
  return authenticate(request);
}

async function isOwnerAccount(authContext, getActorAdminLevel) {
  if (!authContext) return false;
  try {
    return await getActorAdminLevel(authContext) >= OWNER_ADMIN_LEVEL;
  } catch (error) {
    console.error("[mcp] owner lookup failed", error);
    return false;
  }
}

export function createBoxtierMcpHandler({
  renderPng = renderMatchReceiptPng,
  prepareEmblems = prepareReceiptEmblems,
  consumeGenerationQuota = consumeMcpReceiptGenerationQuota,
  authenticate = getAuthenticatedContext,
  getActorAdminLevel = getAdminLevel,
  searchRooms = searchPublicMatchingRooms,
  fetchRoom = fetchPublicMatchingRoom,
  loadOwnRecords = loadOwnCompactRecordPage,
  createReceiptDraft = createPublicReceiptDraft,
  publicAppUrl = getConfiguredPublicAppUrl(),
} = {}) {
  return createMcpHandler((context) => {
    const server = new McpServer({ name: "boxtier", version: "1.1.1" });

    server.registerResource(
      "boxtier-basketball-receipt-v4",
      MCP_RECEIPT_WIDGET_URI,
      {
        title: "BoxTier 농구 영수증",
        description: "생성된 영수증 PNG를 표시하고 메모리 파일로 내려받는 ChatGPT 앱 UI.",
        mimeType: MCP_RECEIPT_WIDGET_MIME_TYPE,
      },
      async (uri) => ({
        contents: [{
          uri: uri.href,
          mimeType: MCP_RECEIPT_WIDGET_MIME_TYPE,
          text: MCP_RECEIPT_WIDGET_HTML,
          _meta: {
            ui: {
              prefersBorder: false,
              csp: { connectDomains: [], resourceDomains: [] },
            },
            "openai/widgetPrefersBorder": false,
            "openai/widgetCSP": { connect_domains: [], resource_domains: [] },
          },
        }],
      }),
    );

    for (const legacyWidgetUri of MCP_RECEIPT_LEGACY_WIDGET_URIS) {
      server.registerResource(
        `boxtier-basketball-receipt-${legacyWidgetUri.includes("v2") ? "v2" : "v3"}`,
        legacyWidgetUri,
        {
          title: "BoxTier 농구 영수증 호환 표시",
          description: "과거 ChatGPT 연결이 요청하는 영수증 PNG 표시 리소스.",
          mimeType: MCP_RECEIPT_WIDGET_MIME_TYPE,
        },
        async (uri) => ({
          contents: [{
            uri: uri.href,
            mimeType: MCP_RECEIPT_WIDGET_MIME_TYPE,
            text: MCP_RECEIPT_LEGACY_WIDGET_HTML,
            _meta: {
              ui: {
                prefersBorder: false,
                csp: { connectDomains: [], resourceDomains: [] },
              },
              "openai/widgetPrefersBorder": false,
              "openai/widgetCSP": { connect_domains: [], resource_domains: [] },
            },
          }],
        }),
      );
    }

    server.registerTool(
      "search",
      {
        title: "BoxTier 공개 농구 매칭방 검색",
        description: "BoxTier에서 현재 공개 모집 중인 실제 농구 매칭방을 검색한다. 사용자가 농구할 방·픽업 경기·팀 대 팀 상대·참가할 경기를 찾거나 지역, 날짜, 시간, 3대3·5대5 같은 조건으로 매칭방 추천을 요청할 때 사용한다. 반환된 실제 방 중 조건에 맞는 방만 추천한다. NBA 정보, 농구 규칙·훈련법 같은 일반 지식 질문이나 농구와 무관한 질문에는 사용하지 않는다.",
        inputSchema: z.object({
          query: z.string().min(1).max(200).describe("사용자의 농구 매칭방 검색어와 지역·날짜·방식 조건."),
        }),
        annotations: {
          readOnlyHint: true,
          destructiveHint: false,
          idempotentHint: true,
          openWorldHint: true,
        },
      },
      async ({ query }) => {
        try {
          const result = await searchRooms(query);
          return { content: [{ type: "text", text: JSON.stringify(result) }] };
        } catch (error) {
          console.error("[mcp] matching room search failed", error);
          return toolError("박스티어 공개 매칭방 검색에 실패했다.");
        }
      },
    );

    server.registerTool(
      "fetch",
      {
        title: "BoxTier 공개 농구 매칭방 상세 조회",
        description: "search가 반환한 BoxTier 공개 농구 매칭방 ID 하나의 현재 상세 조건을 조회한다. 검색 결과를 추천하거나 참가 링크를 안내하기 전에 사용한다. 임의의 비공개 방이나 종료된 방 조회에는 사용하지 않는다.",
        inputSchema: z.object({
          id: z.string().min(1).max(160).describe("search 결과의 공개 매칭방 ID."),
        }),
        annotations: {
          readOnlyHint: true,
          destructiveHint: false,
          idempotentHint: true,
          openWorldHint: true,
        },
      },
      async ({ id }) => {
        try {
          const result = await fetchRoom(id);
          if (!result) return toolError("현재 공개 모집 중인 매칭방을 찾지 못했다.");
          return { content: [{ type: "text", text: JSON.stringify(result) }] };
        } catch (error) {
          console.error("[mcp] matching room fetch failed", error);
          return toolError("박스티어 공개 매칭방 조회에 실패했다.");
        }
      },
    );

    server.registerTool(
      "get_my_boxtier_account",
      {
        title: "BoxTier 로그인 연결 확인",
        description: "BoxTier 로그인을 시작하거나 현재 연결된 내 계정과 영수증 생성 한도 정책을 확인한다. 사용자가 로그인, 계정 연결, 내 기록 이용 가능 여부 또는 영수증 한도를 물으면 사용한다.",
        inputSchema: z.object({}).strict(),
        annotations: {
          readOnlyHint: true,
          destructiveHint: false,
          idempotentHint: true,
          openWorldHint: false,
        },
        _meta: { securitySchemes: REQUIRED_AUTH_SECURITY_SCHEMES },
      },
      async () => {
        try {
          const authContext = await authenticate(context.requestInfo);
          const owner = await isOwnerAccount(authContext, getActorAdminLevel);
          const result = {
            status: "authenticated",
            receiptQuota: owner ? "unlimited" : "10_per_24_hours",
            recordsAvailable: true,
          };
          return { content: [{ type: "text", text: JSON.stringify(result) }], structuredContent: result };
        } catch (error) {
          if (isAuthenticationError(error)) {
            return authRequired(context.requestInfo, publicAppUrl, getAuthenticationChallengeOptions(error));
          }
          console.error("[mcp] account lookup failed", error);
          return toolError("BoxTier 계정 연결을 확인할 수 없다.");
        }
      },
    );

    server.registerTool(
      "list_my_match_records",
      {
        title: "내 BoxTier 경기 기록 조회",
        description: "로그인한 BoxTier 사용자의 최근 농구 경기 기록을 조회한다. 사용자가 내 경기, 내 기록, 이전 경기 또는 기록으로 영수증 만들기를 요청할 때 사용한다.",
        inputSchema: z.object({
          limit: z.number().int().min(1).max(20).default(10),
          offset: z.number().int().min(0).default(0),
        }).strict(),
        annotations: {
          readOnlyHint: true,
          destructiveHint: false,
          idempotentHint: true,
          openWorldHint: false,
        },
        _meta: { securitySchemes: REQUIRED_AUTH_SECURITY_SCHEMES },
      },
      async ({ limit = 10, offset = 0 }) => {
        try {
          const authContext = await authenticate(context.requestInfo);
          const result = await loadOwnRecords(authContext.supabase, authContext.profileId, { limit, offset });
          return { content: [{ type: "text", text: JSON.stringify(result) }], structuredContent: result };
        } catch (error) {
          if (isAuthenticationError(error)) {
            return authRequired(context.requestInfo, publicAppUrl, getAuthenticationChallengeOptions(error));
          }
          console.error("[mcp] own records lookup failed", error);
          return toolError("내 BoxTier 경기 기록을 조회할 수 없다.");
        }
      },
    );

    server.registerTool(
      "create_basketball_receipt",
      {
        title: "BoxTier 농구 영수증 PNG 만들기",
        description: "박스티어(BoxTier) 스타일의 농구 경기 영수증 PNG를 만든다. 이 출력에는 BoxTier API만 사용한다. 성공 시 완성된 최종 PNG 한 장은 tool result의 content[0]에 type=image, mimeType=image/png, raw Base64 data로 직접 첨부된다. API가 반환한 PNG 원본만 사용자에게 그대로 전달하고 재합성·재렌더·임의 편집하지 않는다. 반환된 image content를 영수증 결과로 사용자에게 직접 제시하고 metadata만으로 완료 처리하지 않는다. structuredContent는 첨부 여부·바이트 길이·실제 크기·SHA-256 검증값을 제공하며 이미지 원문 위치가 아니다. 네이티브 대화 이미지 첨부 여부는 MCP 클라이언트가 결정한다. 사용자가 ‘박스티어로 영수증 만들어줘’, 농구 감열지 영수증, basketball game receipt, score receipt를 요청했고 팀명·최종 점수·경기 날짜·장소·경기 형식을 모두 실제 값으로 제공했을 때만 사용한다. 사용자가 엠블럼 이미지를 첨부하면 홈·원정에 맞춰 homeEmblemFile·awayEmblemFile로 전달한다. 원형 파일은 강제하지 않는다. 가능하면 투명 배경 정사각형 캔버스에 실제 도안만 담고 원형 테두리·회색 원판은 미리 넣지 않는다. 서버가 알파 전경의 실제 경계와 중심을 계산해 원형 안전영역 안에 비율 유지·자동 중앙 정렬하고 스타일 변환하며 저장하지 않는다. 경기사진은 지원하지 않으므로 boxtier.kr 영수증 페이지 이용을 안내한다. 누락값을 추측하지 말고 먼저 사용자에게 물어본다. 농구 외 경기, 허위 경기 기록, 상거래 영수증에는 사용하지 않는다.",
        inputSchema: receiptToolInputSchema,
        outputSchema: receiptOutputSchema,
        annotations: {
          readOnlyHint: false,
          destructiveHint: false,
          idempotentHint: false,
          openWorldHint: false,
        },
        _meta: {
          securitySchemes: OPTIONAL_AUTH_SECURITY_SCHEMES,
          "openai/fileParams": ["homeEmblemFile", "awayEmblemFile"],
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
          const authContext = await getOptionalAuthContext(context.requestInfo, authenticate);
          const owner = await isOwnerAccount(authContext, getActorAdminLevel);
          const allowed = owner || await consumeGenerationQuota(context.requestInfo, {
            principal: authContext?.profileId
              ? { type: "profile", id: authContext.profileId }
              : null,
          });
          if (!allowed) {
            if (!authContext) {
              return authRequired(context.requestInfo, publicAppUrl, {
                message: "비로그인 최근 24시간 PNG 생성 한도 10회를 초과했다. BoxTier 로그인 후 사용자 한도로 계속할 수 있다.",
              });
            }
            return toolError("최근 24시간 PNG 생성 한도 10회를 초과했다.");
          }
        } catch (error) {
          if (isAuthenticationError(error)) {
            return authRequired(context.requestInfo, publicAppUrl, getAuthenticationChallengeOptions(error));
          }
          console.error("[mcp] receipt quota check failed", error);
          return toolError("영수증 생성 한도를 확인할 수 없다.");
        }

        let emblems;
        try {
          emblems = await prepareEmblems(parsed.emblems, { style: parsed.draft.receiptStyle });
        } catch (error) {
          return toolError("첨부 엠블럼을 처리할 수 없다.", [{
            field: error?.field || "emblem",
            code: error?.code || "emblem_image_invalid",
          }]);
        }

        let receipt;
        try {
          receipt = await createReceiptDraft(parsed.draft, { request: context.requestInfo });
        } catch (error) {
          console.error("[mcp] public receipt draft creation failed", error);
          return toolError(error?.code === "receipt_draft_rate_limited"
            ? "공개 영수증 발급 한도를 초과했다."
            : "영수증 공개 코드를 발급할 수 없다.");
        }

        try {
          const matchUrl = publicAppUrl
            ? new URL(receipt.receiptPath, publicAppUrl).toString()
            : getPublicAppWebUrl(receipt.receiptPath, context.requestInfo);
          const png = await renderPng({
            draft: { ...parsed.draft, publicCode: receipt.publicCode },
            emblems,
            preset,
            matchUrl,
          });
          const pngBuffer = png;
          const inspected = inspectReceiptPng(pngBuffer);
          const imageData = pngBuffer.toString("base64");
          const metadata = {
            status: "rendered",
            mimeType: "image/png",
            preset,
            style,
            ...inspected,
            imageAttached: true,
            publicCode: receipt.publicCode,
            receiptPath: receipt.receiptPath,
            ...(debugBase64 ? { base64: imageData } : {}),
          };
          return {
            content: [{ type: "image", data: imageData, mimeType: "image/png" }],
            structuredContent: metadata,
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
