import { useState } from "react";
import { Flame, MessageCircle, PenLine, Pin, ThumbsUp } from "lucide-react";
import Button from "../components/common/Button.jsx";
import Badge from "../components/common/Badge.jsx";
import Card from "../components/common/Card.jsx";
import { formatKoreanDateTime } from "../../shared/lib/matchTimeUtils.js";
import CommunityPostEditor from "./CommunityPostEditor.jsx";
import CommunityPostDialog, { CommunityAuthorLink } from "./CommunityPostDialog.jsx";
import useCommunityController from "./useCommunityController.js";

function PostMetrics({ post }) {
  return (
    <span className="community-post-metrics">
      <span><ThumbsUp size={14} /> {post.likeCount}</span>
      <span><MessageCircle size={14} /> {post.commentCount}</span>
    </span>
  );
}

export default function Community({ app }) {
  const controller = useCommunityController(app);
  const [composing, setComposing] = useState(false);

  return (
    <div className="page-stack community-page">
      <header className="page-header ui-page-hero ui-design-app-hero">
        <div className="ui-page-hero__copy">
          <p className="eyebrow">Community</p>
          <h1>커뮤니티</h1>
        </div>
        <Button type="button" onClick={() => setComposing(true)}><PenLine size={17} /> 글쓰기</Button>
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
            {[
              ["all", "전체"],
              ["notice", "공지"],
              ["general", "자유"],
            ].map(([id, label]) => (
              <button key={id} type="button" role="tab" aria-selected={controller.category === id} className={controller.category === id ? "active" : ""} onClick={() => controller.setCategory(id)}>{label}</button>
            ))}
          </div>
          <Badge tone="neutral">{controller.posts.length}개</Badge>
        </div>

        {composing ? (
          <CommunityPostEditor
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
              <span>추천</span>
              <span>댓글</span>
            </div>
          ) : null}
          {controller.posts.map((post) => (
            <article key={post.id} className="community-post-row">
              <span className="community-post-labels">
                <Badge tone={post.category === "notice" ? "orange" : "neutral"}>{post.category === "notice" ? "공지" : "자유"}</Badge>
                {post.pinned ? <Pin size={14} aria-label="상단 고정" /> : null}
              </span>
              <button type="button" className="community-post-title" onClick={() => controller.openPost(post)}>{post.title}</button>
              <div className="community-post-author-cell"><CommunityAuthorLink author={post.author} teams={app.state.teams} /></div>
              <time className="community-post-date" dateTime={post.createdAt} title={formatKoreanDateTime(post.createdAt)}>
                {formatKoreanDateTime(post.createdAt, { month: "2-digit", day: "2-digit" })}
              </time>
              <span className="community-post-count community-post-likes" aria-label={`추천 ${post.likeCount}개`}><ThumbsUp size={14} /> {post.likeCount}</span>
              <span className="community-post-count community-post-comments" aria-label={`댓글 ${post.commentCount}개`}><MessageCircle size={14} /> {post.commentCount}</span>
            </article>
          ))}
          {controller.loading && !controller.posts.length ? <div className="ui-empty-state">게시글 불러오는 중</div> : null}
          {!controller.loading && !controller.posts.length ? <div className="ui-empty-state">등록된 게시글이 없습니다.</div> : null}
        </div>
        {controller.page.hasMore ? <Button type="button" variant="secondary" disabled={controller.loading} onClick={controller.loadMore}>{controller.loading ? "불러오는 중" : "더 보기"}</Button> : null}
      </Card>

      <CommunityPostDialog app={app} controller={controller} />
    </div>
  );
}
