import { useEffect, useState } from "react";
import { getProfileIcon } from "../../lib/profileIcons.js";

export function getProfileEmblemUrl(user = {}) {
  if (user.avatarSource === "discord") return user.discordAvatarUrl || user.discordConnection?.avatarUrl || "";
  if (user.avatarSource === "icon") return getProfileIcon(user.avatarIconKey)?.src ?? "";
  return "";
}

export default function ProfileEmblem({ user, className = "", initial, anonymous = false }) {
  const [imageFailed, setImageFailed] = useState(false);
  const imageUrl = anonymous ? "" : getProfileEmblemUrl(user);
  const label = anonymous ? "?" : initial ?? user?.name?.slice(0, 1) ?? "?";
  const borderEnabled = !anonymous && user?.avatarBorderEnabled === true;
  const avatarColor = user?.avatarColor || "#58d2c0";
  const borderColor = user?.avatarBorderColor || avatarColor;

  useEffect(() => setImageFailed(false), [imageUrl, user?.avatarIconKey, user?.avatarUpdatedAt]);

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
