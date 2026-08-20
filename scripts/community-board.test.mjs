import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  assertCommunityReplyParent,
  canViewCommunityActivity,
  COMMUNITY_POST_CATEGORIES,
  COMMUNITY_POST_CATEGORY_LABELS,
  COMMUNITY_POST_NAV_CATEGORIES,
  COMMUNITY_PAGE_SIZE,
  getCommunityPopularityScore,
  normalizeCommunityPostDraft,
  selectPopularCommunityPosts,
} from "../shared/lib/communityPolicy.js";
import {
  getCommunityViewDate,
  getCommunityViewerIdentity,
} from "../server/api/community/_viewIdentity.js";
import { isLatestRequest } from "../src/lib/asyncState.js";

const now = Date.parse("2026-08-05T12:00:00.000Z");
const post = (id, hoursAgo, likeCount, commentCount, category = "general") => ({
  id,
  category,
  likeCount,
  commentCount,
  createdAt: new Date(now - hoursAgo * 60 * 60 * 1000).toISOString(),
});

const deferred = () => {
  let resolve;
  const promise = new Promise((nextResolve) => { resolve = nextResolve; });
  return { promise, resolve };
};

function createCookieResponse() {
  const headers = new Map();
  return {
    getHeader(name) {
      return headers.get(String(name).toLowerCase());
    },
    setHeader(name, value) {
      headers.set(String(name).toLowerCase(), value);
    },
    get cookies() {
      const value = headers.get("set-cookie");
      return Array.isArray(value) ? value : [value].filter(Boolean);
    },
  };
}

function useCommunityViewSecret(t) {
  const previous = process.env.COMMUNITY_VIEW_SECRET;
  process.env.COMMUNITY_VIEW_SECRET = "community-view-test-secret";
  t.after(() => {
    if (previous === undefined) delete process.env.COMMUNITY_VIEW_SECRET;
    else process.env.COMMUNITY_VIEW_SECRET = previous;
  });
}

test("늦은 게시글 상세 응답은 새 상세와 닫힌 모달을 덮어쓰지 않는다", async () => {
  let requestId = 0;
  let selectedPost = null;
  let comments = [];
  const open = async (pendingDetail) => {
    const currentRequestId = ++requestId;
    const result = await pendingDetail;
    if (!isLatestRequest(requestId, currentRequestId)) return;
    selectedPost = result.post;
    comments = result.comments;
  };
  const close = () => {
    requestId += 1;
    selectedPost = null;
    comments = [];
  };

  const detailA = deferred();
  const detailB = deferred();
  const openingA = open(detailA.promise);
  const openingB = open(detailB.promise);
  detailB.resolve({ post: { id: "B" }, comments: [{ id: "B-comment" }] });
  await openingB;
  detailA.resolve({ post: { id: "A" }, comments: [{ id: "A-comment" }] });
  await openingA;
  assert.equal(selectedPost.id, "B");
  assert.deepEqual(comments.map(({ id }) => id), ["B-comment"]);

  const detailC = deferred();
  const openingC = open(detailC.promise);
  close();
  detailC.resolve({ post: { id: "C" }, comments: [{ id: "C-comment" }] });
  await openingC;
  assert.equal(selectedPost, null);
  assert.deepEqual(comments, []);
});

test("커뮤니티 상세 모달은 body 잠금과 키보드 포커스 격리를 적용한다", async () => {
  const dialog = await readFile(new URL("../src/pages/CommunityPostDialog.jsx", import.meta.url), "utf8");
  assert.match(dialog, /useBodyScrollLock\(open\)/);
  assert.match(dialog, /querySelector\("\.community-dialog-close"\)\?\.focus\(\)/);
  assert.match(dialog, /event\.key !== "Tab"/);
  assert.match(dialog, /event\.shiftKey \? last : first/);
  assert.match(dialog, /target instanceof window\.HTMLElement && target\.isConnected/);
});

test("인기글은 최근 3일 공지 외 글을 추천 3점과 댓글 1점으로 최대 5개 정렬한다", () => {
  const posts = [
    post("old", 73, 99, 99),
    post("notice", 1, 99, 99, "notice"),
    post("zero", 1, 0, 0),
    post("a", 2, 2, 0),
    post("b", 3, 1, 4),
    post("c", 4, 1, 2),
    post("d", 5, 1, 1),
    post("e", 6, 1, 0),
    post("f", 7, 0, 2),
    post("question", 2, 1, 6, "question"),
  ];

  assert.equal(getCommunityPopularityScore(posts[3]), 6);
  assert.deepEqual(selectPopularCommunityPosts(posts, now).map(({ id }) => id), ["question", "b", "a", "c", "d"]);
});

test("공지는 운영자만 작성하고 답글은 같은 글의 원댓글에만 허용한다", () => {
  assert.throws(() => normalizeCommunityPostDraft({ category: "notice", title: "공지", body: "내용" }, 0), /community_notice_admin_required/);
  assert.throws(() => normalizeCommunityPostDraft({ category: "photo", title: "사진", body: "내용" }, 0), /community_photo_admin_required/);
  assert.equal(normalizeCommunityPostDraft({ category: "notice", title: "공지", body: "내용", pinned: true }, 30).pinned, true);
  assert.equal(normalizeCommunityPostDraft({ category: "photo", title: "사진", body: "내용" }, 30).category, "photo");
  assert.equal(normalizeCommunityPostDraft({ category: "question", title: "질문", body: "내용" }, 0).category, "question");
  assert.equal(normalizeCommunityPostDraft({ category: "team", title: "팀소개", body: "내용" }, 0).category, "team");
  assert.equal(assertCommunityReplyParent({ id: "root", post_id: "post", parent_id: null, status: "published" }, "post"), "root");
  assert.throws(() => assertCommunityReplyParent({ id: "reply", post_id: "post", parent_id: "root", status: "published" }, "post"), /community_reply_parent_invalid/);
});

test("게시판은 공지부터 분류별로 열리고 작성 분류를 현재 탭에 고정한다", async () => {
  const [page, editor, dialog, api, photoMigration, teamMigration] = await Promise.all([
    readFile(new URL("../src/pages/Community.jsx", import.meta.url), "utf8"),
    readFile(new URL("../src/pages/CommunityPostEditor.jsx", import.meta.url), "utf8"),
    readFile(new URL("../src/pages/CommunityPostDialog.jsx", import.meta.url), "utf8"),
    readFile(new URL("../server/api/community/posts.js", import.meta.url), "utf8"),
    readFile(new URL("../supabase/migrations/20260806100000_community_photo_posts.sql", import.meta.url), "utf8"),
    readFile(new URL("../supabase/migrations/20260806120000_community_team_posts.sql", import.meta.url), "utf8"),
  ]);

  assert.deepEqual(COMMUNITY_POST_CATEGORIES, ["notice", "general", "question", "team", "photo"]);
  assert.equal(COMMUNITY_POST_CATEGORY_LABELS.question, "질의");
  assert.equal(COMMUNITY_POST_CATEGORY_LABELS.team, "팀소개");
  assert.deepEqual(COMMUNITY_POST_NAV_CATEGORIES, ["notice", "general", "question", "team"]);
  assert.match(page, /COMMUNITY_POST_NAV_CATEGORIES\.map/);
  assert.match(page, /initialCategory=\{controller\.category\}/);
  assert.doesNotMatch(editor, /<select|<option/);
  assert.match(editor, /type="file"[\s\S]*accept="image\/jpeg,image\/png,image\/webp,image\/avif,image\/heic,image\/heif"/);
  assert.match(dialog, /className="community-post-image"/);
  assert.match(api, /validateWebpImage\(bytes/);
  assert.match(api, /\.from\(COMMUNITY_POST_IMAGE_BUCKET\)[\s\S]*\.upload\(imagePath/);
  assert.match(photoMigration, /category in \('general', 'question', 'photo', 'notice'\)/);
  assert.match(photoMigration, /'community-post-images'[\s\S]*array\['image\/webp'\]/);
  assert.match(teamMigration, /category in \('general', 'question', 'team', 'photo', 'notice'\)/);
});

test("프로필 활동은 30개씩 조회하고 공개 설정을 본인에게는 적용하지 않는다", () => {
  assert.equal(COMMUNITY_PAGE_SIZE, 30);
  assert.equal(canViewCommunityActivity({ communityPosts: false }, "posts", false), false);
  assert.equal(canViewCommunityActivity({ communityComments: false }, "comments", false), false);
  assert.equal(canViewCommunityActivity({ communityPosts: false, communityComments: false }, "posts", true), true);
});

test("커뮤니티 경로와 작성자 프로필카드가 연결되어 있다", async () => {
  const [api, app, sidebar, bottomNav, dialog] = await Promise.all([
    readFile(new URL("../api/index.js", import.meta.url), "utf8"),
    readFile(new URL("../src/App.jsx", import.meta.url), "utf8"),
    readFile(new URL("../src/components/layout/Sidebar.jsx", import.meta.url), "utf8"),
    readFile(new URL("../src/components/layout/BottomNav.jsx", import.meta.url), "utf8"),
    readFile(new URL("../src/pages/CommunityPostDialog.jsx", import.meta.url), "utf8"),
  ]);

  assert.match(api, /\["\/community\/posts", route\(communityPosts, \["POST"\], "publicRead"\)\]/);
  assert.match(app, /path="\/app\/community" element=\{<Community app=\{app\} \/>\}/);
  assert.match(sidebar, /to: "\/app\/community"/);
  assert.match(bottomNav, /to: "\/app\/community"/);
  assert.match(dialog, /<PlayerHoverCard user=\{author\}/);
  assert.doesNotMatch(dialog, /<PlayerHoverCard as="span" user=\{author\}/);
});

test("게스트 커뮤니티는 실제 공개 글만 읽고 쓰기는 인증을 요구한다", async () => {
  const [api, handler, controller, serverActions, loaderActions] = await Promise.all([
    readFile(new URL("../api/index.js", import.meta.url), "utf8"),
    readFile(new URL("../server/api/community/posts.js", import.meta.url), "utf8"),
    readFile(new URL("../src/pages/useCommunityController.js", import.meta.url), "utf8"),
    readFile(new URL("../src/lib/serverActions.js", import.meta.url), "utf8"),
    readFile(new URL("../src/hooks/appData/actions/loaderActions.js", import.meta.url), "utf8"),
  ]);

  assert.match(api, /\["\/community\/posts", route\(communityPosts, \["POST"\], "publicRead"\)\]/);
  assert.match(handler, /PUBLIC_READ_OPERATIONS = new Set\(\["list", "detail", "profileActivity"\]\)/);
  assert.match(handler, /!PUBLIC_READ_OPERATIONS\.has\(operation\) && !hasBearerToken/);
  assert.match(handler, /getCommunityViewerIdentity\(request, response, context\.profileId\)/);
  assert.doesNotMatch(handler, /Boolean\(context\.profileId\)/);
  assert.match(controller, /const remote = isSupabaseConfigured;/);
  assert.match(controller, /canWriteCategory: !app\.demoPreview/);
  assert.match(serverActions, /options\.allowAnonymous !== true/);
  assert.match(loaderActions, /allowAnonymous: publicRead/);
  assert.match(loaderActions, /blocking: operation === "list" \|\| operation === "detail"/);
});

test("커뮤니티 입력 버튼은 서버와 같은 최대 길이에서 막힌다", async () => {
  const [editor, dialog] = await Promise.all([
    readFile(new URL("../src/pages/CommunityPostEditor.jsx", import.meta.url), "utf8"),
    readFile(new URL("../src/pages/CommunityPostDialog.jsx", import.meta.url), "utf8"),
  ]);

  assert.match(editor, /titleLength <= COMMUNITY_POST_TITLE_MAX/);
  assert.match(editor, /bodyLength <= COMMUNITY_POST_BODY_MAX/);
  assert.doesNotMatch(editor, /<select|<option/);
  assert.match(dialog, /commentLength > COMMUNITY_COMMENT_BODY_MAX/);
});

test("게시글 목록은 제목 중심 열과 모바일 두 줄 구조를 사용한다", async () => {
  const [page, styles] = await Promise.all([
    readFile(new URL("../src/pages/Community.jsx", import.meta.url), "utf8"),
    readFile(new URL("../src/styles/features/community-board.css", import.meta.url), "utf8"),
  ]);

  assert.match(page, /community-post-list-head/);
  assert.match(page, /<span>작성자<\/span>[\s\S]*<span>날짜<\/span>[\s\S]*<span>조회<\/span>[\s\S]*<span>추천<\/span>[\s\S]*<span>댓글<\/span>/);
  assert.match(page, /<h1>게시판<\/h1>/);
  assert.match(page, /community-post-views/);
  assert.doesNotMatch(page, /controller\.page\.total\}개/);
  assert.doesNotMatch(page, /community-post-open|ChevronRight/);
  assert.match(page, /post\.imageUrl \? <ImageIcon size=\{15\} aria-label="사진 첨부"/);
  assert.match(page, /community-post-title-line[\s\S]*community-post-comments/);
  assert.match(page, /community-post-meta-line[\s\S]*community-post-likes[\s\S]*community-post-date/);
  assert.match(styles, /"title author"\s*"meta author"/);
  assert.match(styles, /\.community-post-labels \{\s*display: none/);
  assert.match(styles, /\.community-post-title\s*\{[\s\S]*font-size: var\(--font-size-body\)/);
  assert.match(styles, /\.community-post-title-cell \{ flex: 0 1 auto; \}/);
  assert.match(styles, /\.community-post-comments \{\s*flex: 0 0 auto;/);
  assert.match(styles, /\.community-post-author-cell \{[\s\S]*grid-area: author;[\s\S]*align-self: center/);
  assert.match(styles, /\.community-post-author-cell \.community-author > \.avatar\s*\{[\s\S]*width: var\(--space-10\)/);
  assert.match(styles, /\.community-post-views\s*\{\s*display: none/);
  assert.match(styles, /\.community-post-comments > svg\s*\{\s*display: none/);
  assert.match(styles, /width: min\(960px, 100%\)/);
  assert.match(styles, /@media \(min-width: 721px\)[\s\S]*font-size: var\(--font-size-section-title\)/);
  assert.match(styles, /\.community-post-byline \{\s*justify-content: flex-end/);
  assert.match(styles, /@media \(max-width: 720px\)[\s\S]*\.community-post-byline \.community-author small \{\s*display: none/);
});

test("조회수는 방문자별 한국 날짜 하루 한 번만 저장하고 모든 페이지에 숫자를 표시한다", async () => {
  const [api, migration, triggerMigration, pagination, editor] = await Promise.all([
    readFile(new URL("../server/api/community/posts.js", import.meta.url), "utf8"),
    readFile(new URL("../supabase/migrations/20260814120000_community_daily_views.sql", import.meta.url), "utf8"),
    readFile(new URL("../supabase/migrations/20260805170000_community_questions_and_views.sql", import.meta.url), "utf8"),
    readFile(new URL("../src/components/common/Pagination.jsx", import.meta.url), "utf8"),
    readFile(new URL("../src/pages/CommunityPostEditor.jsx", import.meta.url), "utf8"),
  ]);
  assert.match(api, /community_post_daily_views/);
  assert.match(api, /viewer_key_hash/);
  assert.match(api, /view_date/);
  assert.match(api, /error\.code === "23505"/);
  assert.match(api, /community_post_view_record_failed/);
  assert.match(api, /viewCount: Number\(row\.view_count/);
  assert.match(migration, /create table if not exists public\.community_post_daily_views/);
  assert.match(migration, /primary key \(post_id, viewer_key_hash, view_date\)/);
  assert.doesNotMatch(migration, /alter table public\.community_post_views/);
  assert.match(migration, /Asia\/Seoul/);
  assert.match(triggerMigration, /community_post_views_increment_count/);
  assert.match(triggerMigration, /category in \('general', 'question', 'notice'\)/);
  assert.doesNotMatch(pagination, /totalPages <= 1/);
  assert.match(editor, /COMMUNITY_POST_CATEGORIES\.includes\(initialCategory\)/);
});

test("익명 조회 식별자는 서명 쿠키를 재사용하고 한국 날짜가 바뀌면 다시 집계한다", (t) => {
  useCommunityViewSecret(t);
  assert.equal(getCommunityViewDate(new Date("2026-08-14T14:59:59.000Z")), "2026-08-14");
  assert.equal(getCommunityViewDate(new Date("2026-08-14T15:00:00.000Z")), "2026-08-15");

  const firstResponse = createCookieResponse();
  const first = getCommunityViewerIdentity(
    { headers: {} },
    firstResponse,
    "",
    new Date("2026-08-14T14:59:59.000Z"),
  );
  const setCookie = firstResponse.cookies.at(-1);
  assert.equal(first.userId, null);
  assert.equal(first.viewDate, "2026-08-14");
  assert.match(setCookie, /^boxtier_community_viewer=/);
  assert.match(setCookie, /; Path=\/api\/community\/posts; HttpOnly; SameSite=Lax; Max-Age=/);

  const cookie = setCookie.split(";", 1)[0];
  const secondResponse = createCookieResponse();
  const second = getCommunityViewerIdentity(
    { headers: { cookie } },
    secondResponse,
    "",
    new Date("2026-08-14T15:00:00.000Z"),
  );
  assert.equal(second.viewerKeyHash, first.viewerKeyHash);
  assert.equal(second.viewDate, "2026-08-15");
  assert.equal(secondResponse.cookies.length, 0);

  const tamperedCookie = `${cookie.slice(0, -1)}${cookie.endsWith("A") ? "B" : "A"}`;
  const tamperedResponse = createCookieResponse();
  const tampered = getCommunityViewerIdentity(
    { headers: { cookie: tamperedCookie } },
    tamperedResponse,
    "",
    new Date("2026-08-14T15:00:00.000Z"),
  );
  assert.notEqual(tampered.viewerKeyHash, first.viewerKeyHash);
  assert.equal(tamperedResponse.cookies.length, 1);
});

test("로그인 조회 식별자는 프로필을 HMAC하고 익명 쿠키를 만들지 않는다", (t) => {
  useCommunityViewSecret(t);
  const response = createCookieResponse();
  const viewer = getCommunityViewerIdentity(
    { headers: {} },
    response,
    "profile-123",
    new Date("2026-08-14T15:00:00.000Z"),
  );
  assert.equal(viewer.userId, "profile-123");
  assert.equal(viewer.viewDate, "2026-08-15");
  assert.match(viewer.viewerKeyHash, /^[0-9a-f]{64}$/);
  assert.equal(response.cookies.length, 0);
});

test("게시판 페이지와 프로필 활동은 같은 30개 페이지 규칙을 사용한다", async () => {
  const [page, controller, profileActivity, api, hoverCard, settings] = await Promise.all([
    readFile(new URL("../src/pages/Community.jsx", import.meta.url), "utf8"),
    readFile(new URL("../src/pages/useCommunityController.js", import.meta.url), "utf8"),
    readFile(new URL("../src/pages/PlayerCommunityActivity.jsx", import.meta.url), "utf8"),
    readFile(new URL("../server/api/community/posts.js", import.meta.url), "utf8"),
    readFile(new URL("../src/components/profile/PlayerHoverCard.jsx", import.meta.url), "utf8"),
    readFile(new URL("../server/api/settings/sync.js", import.meta.url), "utf8"),
  ]);
  assert.match(page, /<Pagination page=\{controller\.pageIndex\}/);
  assert.doesNotMatch(page, /controller\.loadMore/);
  assert.match(controller, /limit: COMMUNITY_PAGE_SIZE, offset: targetPage \* COMMUNITY_PAGE_SIZE/);
  assert.match(profileActivity, /"profileActivity"[\s\S]*COMMUNITY_PAGE_SIZE/);
  assert.match(api, /operation === "profileActivity"/);
  assert.match(api, /representativeTeam: fromRemoteTeam/);
  assert.match(hoverCard, /userTeams\.find[\s\S]*projectedRepresentativeTeam[\s\S]*getRepresentativeTeam/);
  assert.match(settings, /"communityPosts", "communityComments"/);
});

test("상세 조회 실패는 목록 문맥을 보존하고 같은 게시글을 재시도한다", async () => {
  const [controller, page, dialog] = await Promise.all([
    readFile(new URL("../src/pages/useCommunityController.js", import.meta.url), "utf8"),
    readFile(new URL("../src/pages/Community.jsx", import.meta.url), "utf8"),
    readFile(new URL("../src/pages/CommunityPostDialog.jsx", import.meta.url), "utf8"),
  ]);

  assert.match(controller, /const \[detailError, setDetailError\] = useState\(""\)/);
  assert.match(controller, /const detailTargetRef = useRef\(null\)/);
  assert.match(controller, /setDetailError\(getCommunityErrorMessage\(loadError\.message\)\)/);
  assert.match(controller, /const retryDetail = \(\) => detailTargetRef\.current/);
  assert.match(page, /controller\.detailError/);
  assert.match(page, /controller\.retryDetail/);
  assert.match(dialog, /detailError \?/);
  assert.match(dialog, /controller\.retryDetail\(\)/);
  assert.match(dialog, /!detailLoading && !detailError && !editing/);
});
