import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { Eye, MessageCircle, ThumbsUp } from "lucide-react";
import Badge from "../components/common/Badge.jsx";
import Button from "../components/common/Button.jsx";
import Card from "../components/common/Card.jsx";
import Pagination from "../components/common/Pagination.jsx";
import { formatKoreanDateTime } from "../../shared/lib/matchTimeUtils.js";
import { canViewCommunityActivity, COMMUNITY_PAGE_SIZE } from "../../shared/lib/communityPolicy.js";

export default function PlayerCommunityActivity({ app, player, isOwnProfile }) {
  const canViewPosts = canViewCommunityActivity(player.privacy, "posts", isOwnProfile);
  const canViewComments = canViewCommunityActivity(player.privacy, "comments", isOwnProfile);
  const [kind, setKind] = useState(canViewPosts ? "posts" : "comments");
  const [pageIndex, setPageIndex] = useState(0);
  const [items, setItems] = useState([]);
  const [page, setPage] = useState({ total: 0, limit: COMMUNITY_PAGE_SIZE });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [reloadToken, setReloadToken] = useState(0);
  const requestRef = useRef(0);

  useEffect(() => {
    if ((kind === "posts" && canViewPosts) || (kind === "comments" && canViewComments)) return;
    setKind(canViewPosts ? "posts" : "comments");
    setPageIndex(0);
  }, [canViewComments, canViewPosts, kind]);

  useEffect(() => {
    if (!app.actions.community || app.remoteReady === false) return;
    const requestId = ++requestRef.current;
    setLoading(true);
    setError("");
    void app.actions.community("profileActivity", {
      profileId: player.id,
      kind,
      offset: pageIndex * COMMUNITY_PAGE_SIZE,
    }).then((result) => {
      if (requestId !== requestRef.current) return;
      if (!result || result.ok === false) throw new Error(result?.error || "community_profile_activity_failed");
      setItems(result.items ?? []);
      setPage(result.page ?? { total: 0, limit: COMMUNITY_PAGE_SIZE });
    }).catch(() => {
      if (requestId !== requestRef.current) return;
      setItems([]);
      setError("커뮤니티 활동을 불러오지 못했습니다.");
    }).finally(() => {
      if (requestId === requestRef.current) setLoading(false);
    });
  }, [app.actions.community, app.remoteReady, kind, pageIndex, player.id, reloadToken]);

  if (!canViewPosts && !canViewComments) return null;
  const totalPages = Math.max(1, Math.ceil(page.total / page.limit));
  const availableKinds = [
    canViewPosts ? ["posts", "게시글"] : null,
    canViewComments ? ["comments", "댓글"] : null,
  ].filter(Boolean);

  return (
    <Card id="community" className="section-card player-community-card">
      <div className="section-title-row">
        <div>
          <p className="eyebrow">Community</p>
          <h2>커뮤니티 활동</h2>
        </div>
        <Badge tone="neutral">{page.total}개</Badge>
      </div>
      {availableKinds.length > 1 ? (
        <div className="ui-segmented-control segmented-control" role="tablist" aria-label="커뮤니티 활동 분류">
          {availableKinds.map(([id, label]) => (
            <button key={id} type="button" role="tab" aria-selected={kind === id} className={kind === id ? "active" : ""} onClick={() => { setKind(id); setPageIndex(0); }}>{label}</button>
          ))}
        </div>
      ) : null}
      <div className="player-community-list">
        {items.map((item) => {
          const post = kind === "posts" ? item : item.post;
          if (!post?.id) return null;
          return (
            <Link key={item.id} to={`/app/community?post=${post.id}`}>
              <span>
                <strong>{post.title}</strong>
                {kind === "comments" ? <p>{item.body}</p> : null}
              </span>
              <time dateTime={item.createdAt}>{formatKoreanDateTime(item.createdAt, { month: "2-digit", day: "2-digit" })}</time>
              {kind === "posts" ? <small><Eye size={13} /> {item.viewCount} <ThumbsUp size={13} /> {item.likeCount} <MessageCircle size={13} /> {item.commentCount}</small> : null}
            </Link>
          );
        })}
        {loading ? <div className="ui-empty-state-compact">불러오는 중</div> : null}
        {!loading && !error && !items.length ? <div className="ui-empty-state-compact">공개된 {kind === "posts" ? "게시글" : "댓글"}이 없습니다.</div> : null}
        {error ? <div className="ui-empty-state-compact">{error}<Button type="button" size="sm" variant="secondary" onClick={() => setReloadToken((value) => value + 1)}>다시 시도</Button></div> : null}
      </div>
      <Pagination page={pageIndex} totalPages={totalPages} disabled={loading} onChange={setPageIndex} />
    </Card>
  );
}
