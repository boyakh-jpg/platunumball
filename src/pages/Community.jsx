import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Eye, Flame, Image as ImageIcon, MessageCircle, PenLine, Pin, ThumbsUp } from "lucide-react";
import Button from "../components/common/Button.jsx";
import Badge from "../components/common/Badge.jsx";
import Card from "../components/common/Card.jsx";
import Pagination from "../components/common/Pagination.jsx";
import { formatKoreanDateTime } from "../../shared/lib/matchTimeUtils.js";
import { COMMUNITY_POST_CATEGORY_LABELS, COMMUNITY_POST_NAV_CATEGORIES } from "../../shared/lib/communityPolicy.js";
import CommunityPostEditor from "./CommunityPostEditor.jsx";
import CommunityPostDialog, { CommunityAuthorLink } from "./CommunityPostDialog.jsx";
import useCommunityController from "./useCommunityController.js";

function PostMetrics({ post }) {
  return (
    <span className="community-post-metrics">
      <span><Eye size={14} /> {post.viewCount}</span>
      <span><ThumbsUp size={14} /> {post.likeCount}</span>
      <span><MessageCircle size={14} /> {post.commentCount}</span>
    </span>
  );
}

export default function Community({ app }) {
  const controller = useCommunityController(app);
  const [composing, setComposing] = useState(false);
  const [searchParams, setSearchParams] = useSearchParams();
  const openedPostIdRef = useRef("");
  const linkedPostId = searchParams.get("post")?.trim() ?? "";
  const totalPages = Math.max(1, Math.ceil(controller.page.total / controller.page.limit));

  useEffect(() => {
    if (!linkedPostId) {
      openedPostIdRef.current = "";
      return;
    }
    if (openedPostIdRef.current === linkedPostId) return;
    openedPostIdRef.current = linkedPostId;
    void controller.openPost({ id: linkedPostId });
  }, [linkedPostId]);

  const closePost = () => {
    if (linkedPostId) {
      const nextParams = new URLSearchParams(searchParams);
      nextParams.delete("post");
      setSearchParams(nextParams, { replace: true });
    }
    controller.closePost();
  };

  return (
    <div className="page-stack community-page">
      <header className="page-header ui-page-hero ui-design-app-hero">
        <div className="ui-page-hero__copy">
          <p className="eyebrow">Board</p>
          <h1>게시판</h1>
        </div>
      </header>

      {controller.popularPosts.length ? (
        <section className="community-popular" aria-labelledby="community-popular-title">
          <div className="section-title-row">
            <div>
              <p className="eyebrow">최근 3일</p>
              <h2 id="community-popular-title">인기글</h2>
            </div>
            <Flame size={20} />
          </div>
          <div className="community-popular-list">
            {controller.popularPosts.map((post, index) => (
              <button key={post.id} type="button" onClick={() => controller.openPost(post)}>
                <strong>{index + 1}</strong>
                <span>{post.title}</span>
                <PostMetrics post={post} />
              </button>
            ))}
          </div>
        </section>
      ) : null}

      <Card className="section-card community-board">
        <div className="community-board-toolbar">
          <div className="ui-segmented-control segmented-control" role="tablist" aria-label="게시글 분류">
            {COMMUNITY_POST_NAV_CATEGORIES.map((id) => (
              <button key={id} type="button" role="tab" aria-selected={controller.category === id} className={controller.category === id ? "active" : ""} onClick={() => controller.setCategory(id)}>{COMMUNITY_POST_CATEGORY_LABELS[id]}</button>
            ))}
          </div>
          {controller.canWriteCategory ? <Button type="button" onClick={() => controller.requireLogin() || setComposing(true)}><PenLine size={17} /> 글쓰기</Button> : null}
        </div>

        {composing ? (
          <CommunityPostEditor
            initialCategory={controller.category}
            canModerate={controller.canModerate}
            pending={controller.pending}
            onCancel={() => setComposing(false)}
            onSave={async (draft) => {
              if (await controller.savePost(draft)) setComposing(false);
            }}
          />
        ) : null}
        {controller.error && !controller.selectedPost ? <small className="form-warning" role="status">{controller.error}</small> : null}

        <div className="community-post-list">
          {controller.posts.length ? (
            <div className="community-post-list-head" aria-hidden="true">
              <span>분류</span>
              <span>제목</span>
              <span>작성자</span>
              <span>날짜</span>
              <span>조회</span>
              <span>추천</span>
              <span>댓글</span>
            </div>
          ) : null}
          {controller.posts.map((post) => (
            <article key={post.id} className="community-post-row">
              <span className="community-post-labels">
                <Badge tone={post.category === "notice" ? "orange" : post.category === "question" ? "blue" : "neutral"}>{COMMUNITY_POST_CATEGORY_LABELS[post.category] ?? "자유"}</Badge>
              </span>
              <span className="community-post-title-line">
                <span className="community-post-title-cell">
                  {post.pinned ? <Pin size={14} aria-label="상단 고정" /> : null}
                  <button type="button" className="community-post-title" onClick={() => controller.openPost(post)}>{post.title}</button>
                  {post.imageUrl ? <ImageIcon size={15} aria-label="사진 첨부" /> : null}
                </span>
                <span className="community-post-count community-post-comments" aria-label={`댓글 ${post.commentCount}개`}><MessageCircle size={14} /> {post.commentCount}</span>
              </span>
              <div className="community-post-author-cell"><CommunityAuthorLink author={post.author} teams={app.state.teams} /></div>
              <span className="community-post-meta-line">
                <span className="community-post-count community-post-likes" aria-label={`추천 ${post.likeCount}개`}><ThumbsUp size={14} /> {post.likeCount}</span>
                <time className="community-post-date" dateTime={post.createdAt} title={formatKoreanDateTime(post.createdAt)}>
                  {formatKoreanDateTime(post.createdAt, { month: "2-digit", day: "2-digit" })}
                </time>
                <span className="community-post-count community-post-views" aria-label={`조회 ${post.viewCount}회`}><Eye size={14} /> {post.viewCount}</span>
              </span>
            </article>
          ))}
          {controller.loading && !controller.posts.length ? <div className="ui-empty-state">게시글 불러오는 중</div> : null}
          {!controller.loading && !controller.posts.length ? <div className="ui-empty-state">등록된 게시글이 없습니다.</div> : null}
        </div>
        <Pagination page={controller.pageIndex} totalPages={totalPages} disabled={controller.loading} onChange={controller.goToPage} />
      </Card>

      <CommunityPostDialog app={app} controller={{ ...controller, closePost }} />
    </div>
  );
}
