import { useEffect, useState } from "react";
import { ImagePlus, Send, Trash2, X } from "lucide-react";
import Button from "../components/common/Button.jsx";
import { COMMUNITY_POST_BODY_MAX, COMMUNITY_POST_TITLE_MAX } from "../../shared/lib/communityPolicy.js";
import { getCommunityPostImageErrorMessage, prepareCommunityPostImage } from "../lib/communityPostImage.js";

function getInitialDraft(initialPost, initialCategory) {
  const category = ["notice", "question", "photo"].includes(initialPost?.category)
    ? initialPost.category
    : initialCategory === "photo" ? "photo" : "general";
  return {
    category,
    title: initialPost?.title ?? "",
    body: initialPost?.body ?? "",
    pinned: initialPost?.pinned === true,
    imageBase64: "",
    imagePreviewUrl: initialPost?.imageUrl ?? "",
    imageName: initialPost?.imageUrl ? "등록된 사진" : "",
  };
}

export default function CommunityPostEditor({ initialPost = null, initialCategory = "general", canModerate = false, pending = false, onCancel, onSave }) {
  const [draft, setDraft] = useState(() => getInitialDraft(initialPost, initialCategory));
  const [imagePending, setImagePending] = useState(false);
  const [imageError, setImageError] = useState("");

  useEffect(() => {
    setDraft(getInitialDraft(initialPost, initialCategory));
    setImageError("");
  }, [initialCategory, initialPost]);

  const titleLength = draft.title.trim().length;
  const bodyLength = draft.body.trim().length;
  const canSubmit = titleLength >= 2 && titleLength <= COMMUNITY_POST_TITLE_MAX
    && bodyLength >= 2 && bodyLength <= COMMUNITY_POST_BODY_MAX
    && (draft.category !== "photo" || Boolean(draft.imageBase64 || draft.imagePreviewUrl))
    && !pending
    && !imagePending;
  return (
    <form className="community-post-editor form-stack" onSubmit={async (event) => {
      event.preventDefault();
      if (canSubmit) {
        const { imagePreviewUrl, imageName, ...payload } = draft;
        await onSave(payload);
      }
    }}>
      <label>
        분류
        <select value={draft.category} onChange={(event) => setDraft((current) => ({
          ...current,
          category: event.target.value,
          pinned: event.target.value === "notice" && current.pinned,
          ...(event.target.value === "photo" ? {} : { imageBase64: "", imagePreviewUrl: "", imageName: "" }),
        }))}>
          <option value="general">자유</option>
          <option value="question">질문</option>
          {canModerate ? <option value="photo">사진</option> : null}
          {canModerate ? <option value="notice">공지</option> : null}
        </select>
      </label>
      <label>
        제목
        <input autoFocus maxLength={COMMUNITY_POST_TITLE_MAX} value={draft.title} onChange={(event) => setDraft((current) => ({ ...current, title: event.target.value }))} />
        <small>{titleLength}/{COMMUNITY_POST_TITLE_MAX}</small>
      </label>
      <label>
        내용
        <textarea maxLength={COMMUNITY_POST_BODY_MAX} value={draft.body} onChange={(event) => setDraft((current) => ({ ...current, body: event.target.value }))} />
        <small>{bodyLength}/{COMMUNITY_POST_BODY_MAX}</small>
      </label>
      {canModerate && draft.category === "photo" ? (
        <div className="community-photo-field">
          <label>
            사진 첨부
            <span className="community-photo-input">
              <ImagePlus size={18} />
              <span>{imagePending ? "사진 최적화 중" : draft.imageName || "사진 1장 선택"}</span>
              <input
                type="file"
                accept="image/jpeg,image/png,image/webp,image/avif,image/heic,image/heif"
                disabled={pending || imagePending}
                onChange={async (event) => {
                  const file = event.target.files?.[0];
                  event.target.value = "";
                  if (!file) return;
                  setImagePending(true);
                  setImageError("");
                  try {
                    const image = await prepareCommunityPostImage(file);
                    setDraft((current) => ({ ...current, imageBase64: image.imageBase64, imagePreviewUrl: image.previewUrl, imageName: image.imageName }));
                  } catch (error) {
                    setImageError(getCommunityPostImageErrorMessage(error.code || error.message));
                  } finally {
                    setImagePending(false);
                  }
                }}
              />
            </span>
          </label>
          {draft.imagePreviewUrl ? (
            <div className="community-photo-preview">
              <img src={draft.imagePreviewUrl} alt="첨부 사진 미리보기" />
              <Button type="button" variant="secondary" size="sm" disabled={pending || imagePending} onClick={() => setDraft((current) => ({ ...current, imageBase64: "", imagePreviewUrl: "", imageName: "" }))}><Trash2 size={15} /> 사진 제거</Button>
            </div>
          ) : null}
          {imageError ? <small className="form-warning" role="status">{imageError}</small> : null}
        </div>
      ) : null}
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
