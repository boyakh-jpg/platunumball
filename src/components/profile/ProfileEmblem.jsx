import { useEffect, useState } from "react";
import { assetUrl } from "../../lib/assets.js";

function getDiscordAvatarUrl(user = {}) {
  return user?.discordAvatarUrl || user?.discordConnection?.avatarUrl || "";
}

export function getProfileEmblemUrl(user = {}) {
  const source = user?.avatarSource || (getDiscordAvatarUrl(user) ? "discord" : "initial");
  if (source === "upload" && user?.avatarKey) {
    return assetUrl(`/${String(user.avatarKey).replace(/^\/+/, "")}`);
  }
  if (source === "discord") return getDiscordAvatarUrl(user);
  return "";
}

export default function ProfileEmblem({ user, className = "", initial, anonymous = false }) {
  const [imageFailed, setImageFailed] = useState(false);
  const imageUrl = anonymous ? "" : getProfileEmblemUrl(user);
  const label = anonymous ? "?" : initial ?? user?.name?.slice(0, 1) ?? "?";
  const borderEnabled = !anonymous && user?.avatarBorderEnabled === true;
  const avatarColor = user?.avatarColor || "#58d2c0";
  const borderColor = user?.avatarBorderColor || avatarColor;

  useEffect(() => setImageFailed(false), [imageUrl, user?.avatarUpdatedAt]);

  return (
    <span
      aria-hidden="true"
      className={`avatar ${imageUrl && !imageFailed ? "image-avatar" : ""} ${borderEnabled ? "has-emblem-border" : ""} ${anonymous ? "anonymous" : ""} ${className}`.trim()}
      style={{
        "--avatar": avatarColor,
        "--avatar-border": borderColor,
      }}
    >
      {label}
      {imageUrl && !imageFailed ? <img className="profile-emblem-image" src={imageUrl} alt="" loading="lazy" decoding="async" onError={() => setImageFailed(true)} /> : null}
    </span>
  );
}
