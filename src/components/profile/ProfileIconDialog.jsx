import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { Link } from "react-router-dom";
import { assetUrl } from "../../lib/assets.js";
import {
  DEFAULT_PROFILE_ICON_ID,
  DEFAULT_UNLOCKED_PROFILE_ICON_KEYS,
  PROFILE_ICON_CATALOG,
  PROFILE_ICON_GROUPS,
} from "../../lib/profileIcons.js";
import { getTeamEmblemErrorMessage } from "../../lib/teamEmblem.js";
import Button from "../common/Button.jsx";
import ModalShell from "../common/ModalShell.jsx";
import ProfileEmblem from "./ProfileEmblem.jsx";

const DEFAULT_UNLOCKED_KEYS = DEFAULT_UNLOCKED_PROFILE_ICON_KEYS;

function getInitialDraft(user) {
  return {
    avatarSource: new Set(["discord", "icon"]).has(user.avatarSource) ? user.avatarSource : "initial",
    avatarIconKey: user.avatarIconKey || DEFAULT_PROFILE_ICON_ID,
    avatarColor: user.avatarColor || "#58d2c0",
    avatarBackgroundEnabled: user.avatarBackgroundEnabled !== false,
    avatarBorderEnabled: user.avatarBorderEnabled === true,
    avatarBorderColor: user.avatarBorderColor || user.avatarColor || "#58d2c0",
  };
}

function ProfileIconPreviewDialog({ icon, user, draft, onClose }) {
  return createPortal(
    <div className="app-confirm-backdrop profile-icon-preview-backdrop" role="presentation" onMouseDown={onClose}>
      <ModalShell className="app-confirm-dialog profile-icon-preview-dialog" role="dialog" aria-modal="true" aria-labelledby="profile-icon-preview-title" onMouseDown={(event) => event.stopPropagation()}>
        <header className="profile-icon-preview-header">
          <div>
            <p className="eyebrow">Icon Preview</p>
            <strong id="profile-icon-preview-title">{icon.name}</strong>
          </div>
          <Button type="button" size="sm" variant="secondary" aria-label="확대보기 닫기" onClick={onClose}>닫기</Button>
        </header>
        <div className="profile-icon-preview-stage">
          <ProfileEmblem
            user={{ ...user, ...draft, avatarSource: "icon", avatarIconKey: icon.id }}
            className="profile-icon-large-preview"
          />
        </div>
      </ModalShell>
    </div>,
    document.body,
  );
}

export default function ProfileIconDialog({ user, actions, onClose, onSaved }) {
  const [draft, setDraft] = useState(() => getInitialDraft(user));
  const [selectedGroupId, setSelectedGroupId] = useState(() => (
    PROFILE_ICON_GROUPS.find((group) => group.icons.some((icon) => icon.id === user.avatarIconKey))?.id
      ?? PROFILE_ICON_GROUPS[0].id
  ));
  const [unlockedIconKeys, setUnlockedIconKeys] = useState(() => [...new Set([...DEFAULT_UNLOCKED_KEYS, user.avatarIconKey].filter(Boolean))]);
  const [loading, setLoading] = useState(true);
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [loadError, setLoadError] = useState("");
  const [pending, setPending] = useState(false);
  const [feedback, setFeedback] = useState("");
  const [previewIcon, setPreviewIcon] = useState(null);
  const hasDiscordAvatar = Boolean(user.discordAvatarUrl || user.discordConnection?.avatarUrl);
  const unlockedSet = useMemo(() => new Set(unlockedIconKeys), [unlockedIconKeys]);
  const unlockedGroups = useMemo(() => PROFILE_ICON_GROUPS
    .map((group) => ({ ...group, icons: group.icons.filter((icon) => unlockedSet.has(icon.id)) }))
    .filter((group) => group.icons.length > 0), [unlockedSet]);
  const selectedGroup = unlockedGroups.find((group) => group.id === selectedGroupId) ?? unlockedGroups[0] ?? null;

  useEffect(() => {
    let active = true;
    setLoading(true);
    setLoadError("");
    Promise.resolve(actions.loadProfileIconAchievements?.())
      .then((result) => {
        if (!active) return;
        if (!result || result?.ok === false) {
          setLoadError("프로필 아이콘을 불러오지 못했습니다.");
          return;
        }
        if (Array.isArray(result?.unlockedIconKeys)) {
          setUnlockedIconKeys([...new Set([
            ...DEFAULT_UNLOCKED_KEYS,
            ...result.unlockedIconKeys,
            user.avatarIconKey,
          ].filter(Boolean))]);
        }
      })
      .catch(() => {
        if (active) setLoadError("프로필 아이콘을 불러오지 못했습니다.");
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [actions.loadProfileIconAchievements, loadAttempt]);

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKeyDown = (event) => {
      if (event.key !== "Escape") return;
      if (previewIcon) {
        setPreviewIcon(null);
        return;
      }
      if (!pending) onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [onClose, pending, previewIcon]);

  const selectSource = (avatarSource) => {
    if (avatarSource === "discord" && !hasDiscordAvatar) {
      setFeedback("먼저 설정에서 Discord 계정을 연결해 주세요.");
      return;
    }
    const fallbackIcon = unlockedGroups[0]?.icons[0]?.id || DEFAULT_PROFILE_ICON_ID;
    setDraft((current) => ({
      ...current,
      avatarSource,
      avatarIconKey: avatarSource === "icon" && !unlockedSet.has(current.avatarIconKey) ? fallbackIcon : current.avatarIconKey,
    }));
    setFeedback("");
  };

  const selectIcon = (avatarIconKey) => {
    if (!unlockedSet.has(avatarIconKey)) return;
    setDraft((current) => ({ ...current, avatarSource: "icon", avatarIconKey }));
    setFeedback("");
  };

  const submit = async (event) => {
    event.preventDefault();
    if (pending) return;
    if (draft.avatarSource === "icon" && !unlockedSet.has(draft.avatarIconKey)) {
      setFeedback("아직 해금되지 않은 아이콘입니다.");
      return;
    }

    setPending(true);
    setFeedback("");
    try {
      const result = await actions.saveProfileIconSettings(draft);
      if (!result || result?.ok === false) {
        setFeedback(getTeamEmblemErrorMessage(result?.error));
        return;
      }
      onSaved?.(result);
      onClose();
    } catch (error) {
      setFeedback(getTeamEmblemErrorMessage(error?.code || error?.message));
    } finally {
      setPending(false);
    }
  };

  return (
    <>
      <div className="app-confirm-backdrop profile-icon-dialog-backdrop" role="presentation" onMouseDown={() => !pending && onClose()}>
        <ModalShell as="form" className="app-confirm-dialog profile-icon-dialog" role="dialog" aria-modal="true" aria-labelledby="profile-icon-dialog-title" onSubmit={submit} onMouseDown={(event) => event.stopPropagation()}>
        <header className="profile-icon-dialog-header">
          <div>
            <p className="eyebrow">My Icon</p>
            <strong id="profile-icon-dialog-title">프로필 아이콘 선택</strong>
          </div>
          <Button type="button" size="sm" variant="secondary" aria-label="닫기" disabled={pending} onClick={onClose}>닫기</Button>
        </header>

        <div className="profile-icon-dialog-preview">
          <ProfileEmblem user={{ ...user, ...draft }} className="hero-avatar" />
          <span>{draft.avatarSource === "initial" ? "기본값" : draft.avatarSource === "discord" ? "Discord" : "아이콘"}</span>
        </div>

        <div className="emblem-source-grid profile-icon-source-grid">
          <Button type="button" variant={draft.avatarSource === "initial" ? "primary" : "secondary"} aria-pressed={draft.avatarSource === "initial"} disabled={pending} onClick={() => selectSource("initial")}>
            <strong>기본값</strong>
          </Button>
          <Button type="button" variant={draft.avatarSource === "discord" ? "primary" : "secondary"} aria-pressed={draft.avatarSource === "discord"} disabled={pending || !hasDiscordAvatar} onClick={() => selectSource("discord")}>
            <strong>Discord</strong>
          </Button>
          <Button type="button" variant={draft.avatarSource === "icon" ? "primary" : "secondary"} aria-pressed={draft.avatarSource === "icon"} disabled={pending || loading || !unlockedGroups.length} onClick={() => selectSource("icon")}>
            <strong>아이콘</strong>
          </Button>
        </div>

        {draft.avatarSource === "icon" ? (
          <div className="profile-icon-picker">
            <div className="profile-icon-group-tabs" role="tablist" aria-label="프로필 아이콘 분류">
              {unlockedGroups.map((group) => (
                <Button key={group.id} type="button" size="sm" variant={selectedGroup?.id === group.id ? "primary" : "secondary"} role="tab" aria-selected={selectedGroup?.id === group.id} onClick={() => setSelectedGroupId(group.id)}>
                  {group.name} <small>{group.icons.length}</small>
                </Button>
              ))}
            </div>
            <div className="profile-icon-catalog" role="list" aria-label={`${selectedGroup?.name ?? "보유"} 프로필 아이콘`}>
              {selectedGroup?.icons.map((icon) => {
                const selected = draft.avatarIconKey === icon.id;
                return (
                  <div
                    key={icon.id}
                    role="listitem"
                    className={`profile-icon-catalog-item ${selected ? "active" : ""}`.trim()}
                  >
                    <button type="button" className="profile-icon-preview-trigger" aria-label={`${icon.name} 크게 보기`} disabled={pending} onClick={() => setPreviewIcon(icon)}>
                      <span className="profile-icon-catalog-image">
                        <img src={assetUrl(icon.src)} alt="" loading="lazy" decoding="async" />
                      </span>
                    </button>
                    <button
                      type="button"
                      className="profile-icon-select-trigger"
                      disabled={pending}
                      aria-pressed={selected}
                      aria-label={`${icon.name} 선택`}
                      onClick={() => selectIcon(icon.id)}
                    >
                      <strong>{icon.name}</strong>
                    </button>
                  </div>
                );
              })}
            </div>
          </div>
        ) : null}

        {draft.avatarSource !== "discord" ? (
          <div className="emblem-style-controls profile-icon-color-controls">
            {draft.avatarSource === "initial" ? (
              <>
                <label className="emblem-border-toggle">
                  <input type="checkbox" checked={draft.avatarBackgroundEnabled} onChange={(event) => setDraft((current) => ({ ...current, avatarBackgroundEnabled: event.target.checked }))} />
                  배경색 사용
                </label>
                <label>
                  배경색
                  <input type="color" value={draft.avatarColor} disabled={!draft.avatarBackgroundEnabled} onChange={(event) => setDraft((current) => ({ ...current, avatarColor: event.target.value }))} />
                </label>
              </>
            ) : null}
            <label className="emblem-border-toggle">
              <input type="checkbox" checked={draft.avatarBorderEnabled} onChange={(event) => setDraft((current) => ({ ...current, avatarBorderEnabled: event.target.checked }))} />
              테두리 사용
            </label>
            <label>
              테두리색
              <input type="color" value={draft.avatarBorderColor} disabled={!draft.avatarBorderEnabled} onChange={(event) => setDraft((current) => ({ ...current, avatarBorderColor: event.target.value }))} />
            </label>
          </div>
        ) : null}

        {loadError ? (
          <p className="form-warning profile-icon-dialog-feedback">
            {loadError} <button type="button" className="button ui-button button-secondary ui-button-secondary button-sm ui-button-sm" onClick={() => setLoadAttempt((attempt) => attempt + 1)}>다시 시도</button>
          </p>
        ) : null}
        {feedback ? <p className="form-warning profile-icon-dialog-feedback">{feedback}</p> : null}
        <footer className="ui-action-row profile-icon-dialog-actions">
          <Button as={Link} variant="secondary" size="sm" to="/app/profile/achievements" onClick={onClose}>업적 보기</Button>
          <Button type="submit" size="sm" disabled={pending || loading}>{pending ? "저장 중" : "저장"}</Button>
        </footer>
        </ModalShell>
      </div>
      {previewIcon ? <ProfileIconPreviewDialog icon={previewIcon} user={user} draft={draft} onClose={() => setPreviewIcon(null)} /> : null}
    </>
  );
}
