import { useEffect, useState } from "react";
import { Send, X } from "lucide-react";
import Button from "../components/common/Button.jsx";
import { COMMUNITY_POST_BODY_MAX, COMMUNITY_POST_TITLE_MAX } from "../../shared/lib/communityPolicy.js";

export default function CommunityPostEditor({ initialPost = null, canModerate = false, pending = false, onCancel, onSave }) {
  const [draft, setDraft] = useState(() => ({
    category: initialPost?.category === "notice" ? "notice" : "general",
    title: initialPost?.title ?? "",
    body: initialPost?.body ?? "",
    pinned: initialPost?.pinned === true,
  }));

  useEffect(() => {
    setDraft({
      category: initialPost?.category === "notice" ? "notice" : "general",
      title: initialPost?.title ?? "",
      body: initialPost?.body ?? "",
      pinned: initialPost?.pinned === true,
    });
  }, [initialPost]);

  const canSubmit = draft.title.trim().length >= 2 && draft.body.trim().length >= 2 && !pending;
  return (
    <form className="community-post-editor form-stack" onSubmit={async (event) => {
      event.preventDefault();
      if (canSubmit) await onSave(draft);
    }}>
      {canModerate ? (
        <label>
          분류
          <select value={draft.category} onChange={(event) => setDraft((current) => ({ ...current, category: event.target.value, pinned: event.target.value === "notice" && current.pinned }))}>
            <option value="general">자유글</option>
            <option value="notice">공지</option>
          </select>
        </label>
      ) : null}
      <label>
        제목
        <input autoFocus maxLength={COMMUNITY_POST_TITLE_MAX} value={draft.title} onChange={(event) => setDraft((current) => ({ ...current, title: event.target.value }))} />
        <small>{draft.title.trim().length}/{COMMUNITY_POST_TITLE_MAX}</small>
      </label>
      <label>
        내용
        <textarea maxLength={COMMUNITY_POST_BODY_MAX} value={draft.body} onChange={(event) => setDraft((current) => ({ ...current, body: event.target.value }))} />
        <small>{draft.body.trim().length}/{COMMUNITY_POST_BODY_MAX}</small>
      </label>
      {canModerate && draft.category === "notice" ? (
        <label className="community-pin-toggle">
          <input type="checkbox" checked={draft.pinned} onChange={(event) => setDraft((current) => ({ ...current, pinned: event.target.checked }))} />
          <span>목록 상단 고정</span>
        </label>
      ) : null}
      <div className="ui-action-row community-editor-actions">
        <Button type="button" variant="secondary" disabled={pending} onClick={onCancel}><X size={16} /> 취소</Button>
        <Button type="submit" disabled={!canSubmit}><Send size={16} /> {pending ? "저장 중" : initialPost ? "수정" : "등록"}</Button>
      </div>
    </form>
  );
}
