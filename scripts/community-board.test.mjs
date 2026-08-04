import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  assertCommunityReplyParent,
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

test("인기글은 최근 3일 일반 글을 추천 3점과 댓글 1점으로 최대 5개 정렬한다", () => {
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
  ];

  assert.equal(getCommunityPopularityScore(posts[3]), 6);
  assert.deepEqual(selectPopularCommunityPosts(posts, now).map(({ id }) => id), ["b", "a", "c", "d", "e"]);
});

test("공지는 운영자만 작성하고 답글은 같은 글의 원댓글에만 허용한다", () => {
  assert.throws(() => normalizeCommunityPostDraft({ category: "notice", title: "공지", body: "내용" }, 0), /community_notice_admin_required/);
  assert.equal(normalizeCommunityPostDraft({ category: "notice", title: "공지", body: "내용", pinned: true }, 30).pinned, true);
  assert.equal(assertCommunityReplyParent({ id: "root", post_id: "post", parent_id: null, status: "published" }, "post"), "root");
  assert.throws(() => assertCommunityReplyParent({ id: "reply", post_id: "post", parent_id: "root", status: "published" }, "post"), /community_reply_parent_invalid/);
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
  assert.match(page, /<span>작성자<\/span>[\s\S]*<span>날짜<\/span>[\s\S]*<span>추천<\/span>[\s\S]*<span>댓글<\/span>/);
  assert.doesNotMatch(page, /community-post-open|ChevronRight/);
  assert.match(styles, /"labels title title title"\s*"author date likes comments"/);
});
