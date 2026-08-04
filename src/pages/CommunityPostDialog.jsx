import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { MessageCircle, Pencil, Reply, ThumbsUp, Trash2, X } from "lucide-react";
import Button from "../components/common/Button.jsx";
import Badge from "../components/common/Badge.jsx";
import PlayerHoverCard from "../components/profile/PlayerHoverCard.jsx";
import ProfileEmblem from "../components/profile/ProfileEmblem.jsx";
import { getUserHashtag } from "../lib/handles.js";
import { formatKoreanDateTime } from "../../shared/lib/matchTimeUtils.js";
import { COMMUNITY_COMMENT_BODY_MAX } from "../../shared/lib/communityPolicy.js";
import CommunityPostEditor from "./CommunityPostEditor.jsx";

export function CommunityAuthorLink({ author, teams }) {
  if (!author) return <span className="community-author"><span className="avatar small">?</span><strong>사용자</strong></span>;
  return (
    <PlayerHoverCard user={author} teams={teams} className="community-author">
      <ProfileEmblem user={author} className="small" />
      <span><strong>{author.name}</strong><small>{getUserHashtag(author)}</small></span>
    </PlayerHoverCard>
  );
}

function CommunityComment({ comment, replies = [], teams, currentUserId, canModerate, pending, onReply, onDelete }) {
  const canDelete = comment.authorId === currentUserId || canModerate;
  return (
    <div className="community-comment-thread">
      <article className="community-comment">
        <div className="community-comment-head">
          <CommunityAuthorLink author={comment.author} teams={teams} />
          <time>{formatKoreanDateTime(comment.createdAt)}</time>
        </div>
        <p>{comment.body}</p>
        <div className="ui-action-row community-comment-actions">
          <Button type="button" variant="secondary" size="sm" disabled={pending} onClick={() => onReply(comment)}><Reply size={14} /> 답글</Button>
          {canDelete ? <Button type="button" variant="secondary" size="sm" disabled={pending} onClick={() => onDelete(comment.id)}><Trash2 size={14} /> 삭제</Button> : null}
        </div>
      </article>
      {replies.map((reply) => (
        <article key={reply.id} className="community-comment community-comment-reply">
          <div className="community-comment-head">
            <CommunityAuthorLink author={reply.author} teams={teams} />
            <time>{formatKoreanDateTime(reply.createdAt)}</time>
          </div>
          <p>{reply.body}</p>
          {reply.authorId === currentUserId || canModerate ? (
            <div className="ui-action-row community-comment-actions">
              <Button type="button" variant="secondary" size="sm" disabled={pending} onClick={() => onDelete(reply.id)}><Trash2 size={14} /> 삭제</Button>
            </div>
          ) : null}
        </article>
      ))}
    </div>
  );
}

export default function CommunityPostDialog({ app, controller }) {
  const { selectedPost: post, commentThreads, canModerate, detailLoading, pending, error } = controller;
  const [editing, setEditing] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [replyTo, setReplyTo] = useState(null);
  const [commentBody, setCommentBody] = useState("");

  useEffect(() => {
    setEditing(false);
    setConfirmingDelete(false);
    setReplyTo(null);
    setCommentBody("");
  }, [post?.id]);

  useEffect(() => {
    if (!post) return undefined;
    const closeOnEscape = (event) => {
      if (event.key === "Escape" && !pending) controller.closePost();
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [controller.closePost, pending, post]);

  if (!post || typeof document === "undefined") return null;
  const ownsPost = post.authorId === app.currentUserId;
  const canDeletePost = ownsPost || canModerate;
  const submitComment = async (event) => {
    event.preventDefault();
    if (!commentBody.trim() || pending) return;
    if (await controller.saveComment(commentBody, replyTo?.id ?? null)) {
      setCommentBody("");
      setReplyTo(null);
    }
  };

  return createPortal(
    <div className="app-confirm-backdrop community-dialog-backdrop" role="presentation" onMouseDown={() => !pending && controller.closePost()}>
      <section className="app-confirm-dialog community-post-dialog" role="dialog" aria-modal="true" aria-labelledby="community-post-dialog-title" onMouseDown={(event) => event.stopPropagation()}>
        <header className="community-dialog-header">
          <div>
            <Badge tone={post.category === "notice" ? "orange" : "neutral"}>{post.category === "notice" ? "공지" : "자유"}</Badge>
            <h2 id="community-post-dialog-title">{post.title}</h2>
          </div>
          <Button type="button" variant="secondary" size="sm" className="community-dialog-close" aria-label="게시글 닫기" title="닫기" disabled={pending} onClick={controller.closePost}><X size={18} /></Button>
        </header>

        {editing ? (
          <CommunityPostEditor
            initialPost={post}
            canModerate={canModerate}
            pending={pending}
            onCancel={() => setEditing(false)}
            onSave={async (draft) => {
              if (await controller.savePost(draft, post.id)) setEditing(false);
            }}
          />
        ) : (
          <>
            <div className="community-post-byline">
              <CommunityAuthorLink author={post.author} teams={app.state.teams} />
              <time>{formatKoreanDateTime(post.createdAt)}</time>
            </div>
            {detailLoading ? <div className="ui-empty-state-compact">글 불러오는 중</div> : <p className="community-post-body">{post.body}</p>}
            <div className="ui-action-row community-post-actions">
              <Button type="button" variant={post.liked ? "primary" : "secondary"} disabled={pending || detailLoading} aria-pressed={post.liked} onClick={() => controller.toggleLike(post.id)}>
                <ThumbsUp size={16} /> 추천 {post.likeCount}
              </Button>
              <span><MessageCircle size={15} /> 댓글 {post.commentCount}</span>
              {ownsPost ? <Button type="button" variant="secondary" size="sm" disabled={pending || detailLoading} onClick={() => setEditing(true)}><Pencil size={15} /> 수정</Button> : null}
              {canDeletePost ? <Button type="button" variant="secondary" size="sm" disabled={pending} onClick={() => setConfirmingDelete(true)}><Trash2 size={15} /> 삭제</Button> : null}
            </div>
          </>
        )}

        {confirmingDelete ? (
          <div className="community-delete-confirm" role="alert">
            <strong>이 글을 삭제할까요?</strong>
            <div className="ui-action-row">
              <Button type="button" variant="secondary" size="sm" disabled={pending} onClick={() => setConfirmingDelete(false)}>취소</Button>
              <Button type="button" variant="danger" size="sm" disabled={pending} onClick={() => controller.deletePost(post.id)}>{pending ? "삭제 중" : "삭제"}</Button>
            </div>
          </div>
        ) : null}
        {error ? <small className="form-warning" role="status">{error}</small> : null}

        {!detailLoading && !editing ? (
          <section className="community-comments" aria-labelledby="community-comments-title">
            <div className="section-title-row">
              <h3 id="community-comments-title">댓글</h3>
              <Badge tone="neutral">{post.commentCount}</Badge>
            </div>
            <form className="community-comment-form" onSubmit={submitComment}>
              {replyTo ? <div className="community-reply-target"><span>{replyTo.author?.name ?? "사용자"}에게 답글</span><button type="button" aria-label="답글 취소" onClick={() => setReplyTo(null)}><X size={15} /></button></div> : null}
              <textarea maxLength={COMMUNITY_COMMENT_BODY_MAX} value={commentBody} placeholder={replyTo ? "답글 작성" : "댓글 작성"} onChange={(event) => setCommentBody(event.target.value)} />
              <div className="ui-action-row community-comment-submit">
                <small>{commentBody.trim().length}/{COMMUNITY_COMMENT_BODY_MAX}</small>
                <Button type="submit" size="sm" disabled={!commentBody.trim() || pending}>{pending ? "등록 중" : "등록"}</Button>
              </div>
            </form>
            <div className="community-comment-list">
              {commentThreads.map((comment) => (
                <CommunityComment
                  key={comment.id}
                  comment={comment}
                  replies={comment.replies}
                  teams={app.state.teams}
                  currentUserId={app.currentUserId}
                  canModerate={canModerate}
                  pending={pending}
                  onReply={(target) => { setReplyTo(target); setCommentBody(""); }}
                  onDelete={controller.deleteComment}
                />
              ))}
              {!commentThreads.length ? <div className="ui-empty-state-compact">첫 댓글을 남겨보세요.</div> : null}
            </div>
          </section>
        ) : null}
      </section>
    </div>,
    document.body,
  );
}
