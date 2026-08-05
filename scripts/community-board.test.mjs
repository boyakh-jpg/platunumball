import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  assertCommunityReplyParent,
  canViewCommunityActivity,
  COMMUNITY_PAGE_SIZE,
  getCommunityPopularityScore,
  normalizeCommunityPostDraft,
  selectPopularCommunityPosts,
} from "../shared/lib/communityPolicy.js";

const now = Date.parse("2026-08-05T12:00:00.000Z");
const post = (id, hoursAgo, likeCount, commentCount, category = "general") => ({
  id,
  category,
  likeCount,
  commentCount,
  createdAt: new Date(now - hoursAgo * 60 * 60 * 1000).toISOString(),
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
  assert.equal(normalizeCommunityPostDraft({ category: "notice", title: "공지", body: "내용", pinned: true }, 30).pinned, true);
  assert.equal(normalizeCommunityPostDraft({ category: "question", title: "질문", body: "내용" }, 0).category, "question");
  assert.equal(assertCommunityReplyParent({ id: "root", post_id: "post", parent_id: null, status: "published" }, "post"), "root");
  assert.throws(() => assertCommunityReplyParent({ id: "reply", post_id: "post", parent_id: "root", status: "published" }, "post"), /community_reply_parent_invalid/);
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

  assert.match(api, /\["\/community\/posts", route\(communityPosts, \["POST"\], "user"\)\]/);
  assert.match(app, /path="\/app\/community" element=\{<Community app=\{app\} \/>\}/);
  assert.match(sidebar, /to: "\/app\/community"/);
  assert.match(bottomNav, /to: "\/app\/community"/);
  assert.match(dialog, /<PlayerHoverCard user=\{author\}/);
  assert.doesNotMatch(dialog, /<PlayerHoverCard as="span" user=\{author\}/);
});

test("커뮤니티 입력 버튼은 서버와 같은 최대 길이에서 막힌다", async () => {
  const [editor, dialog] = await Promise.all([
    readFile(new URL("../src/pages/CommunityPostEditor.jsx", import.meta.url), "utf8"),
    readFile(new URL("../src/pages/CommunityPostDialog.jsx", import.meta.url), "utf8"),
  ]);

  assert.match(editor, /titleLength <= COMMUNITY_POST_TITLE_MAX/);
  assert.match(editor, /bodyLength <= COMMUNITY_POST_BODY_MAX/);
  assert.match(dialog, /commentLength > COMMUNITY_COMMENT_BODY_MAX/);
});

test("게시글 목록은 제목 중심 열과 모바일 두 줄 구조를 사용한다", async () => {
  const [page, styles] = await Promise.all([
    readFile(new URL("../src/pages/Community.jsx", import.meta.url), "utf8"),
    readFile(new URL("../src/styles/features/community-board.css", import.meta.url), "utf8"),
  ]);

  assert.match(page, /community-post-list-head/);
  assert.match(page, /<span>작성자<\/span>[\s\S]*<span>날짜<\/span>[\s\S]*<span>조회<\/span>[\s\S]*<span>추천<\/span>[\s\S]*<span>댓글<\/span>/);
  assert.match(page, /\["question", "질문"\]/);
  assert.match(page, /community-post-views/);
  assert.doesNotMatch(page, /controller\.page\.total\}개/);
  assert.doesNotMatch(page, /community-post-open|ChevronRight/);
  assert.match(styles, /"labels title comments"\s*"likes date author"/);
  assert.match(styles, /\.community-post-title\s*\{[\s\S]*font-size: var\(--font-size-title-sm\)/);
  assert.match(styles, /\.community-post-author-cell \.community-author > \.avatar\s*\{[\s\S]*width: var\(--space-10\)/);
  assert.match(styles, /\.community-post-views\s*\{\s*display: none/);
  assert.match(styles, /\.community-post-comments > svg\s*\{\s*display: none/);
  assert.match(styles, /width: min\(960px, 100%\)/);
  assert.match(styles, /@media \(min-width: 721px\)[\s\S]*font-size: var\(--font-size-section-title\)/);
  assert.match(styles, /\.community-post-byline \{\s*justify-content: flex-end/);
  assert.match(styles, /@media \(max-width: 720px\)[\s\S]*\.community-post-byline \.community-author small \{\s*display: none/);
});

test("조회수는 계정당 글별 한 번만 저장하고 모든 페이지에 숫자를 표시한다", async () => {
  const [api, migration, pagination, editor] = await Promise.all([
    readFile(new URL("../server/api/community/posts.js", import.meta.url), "utf8"),
    readFile(new URL("../supabase/migrations/20260805170000_community_questions_and_views.sql", import.meta.url), "utf8"),
    readFile(new URL("../src/components/common/Pagination.jsx", import.meta.url), "utf8"),
    readFile(new URL("../src/pages/CommunityPostEditor.jsx", import.meta.url), "utf8"),
  ]);
  assert.match(api, /community_post_views/);
  assert.match(api, /error\.code === "23505"/);
  assert.match(api, /viewCount: Number\(row\.view_count/);
  assert.match(migration, /primary key \(post_id, user_id\)/);
  assert.match(migration, /community_post_views_increment_count/);
  assert.match(migration, /category in \('general', 'question', 'notice'\)/);
  assert.doesNotMatch(pagination, /totalPages <= 1/);
  assert.match(editor, /option value="question">질문/);
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
