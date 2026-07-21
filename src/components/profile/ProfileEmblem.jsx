import { useEffect, useState } from "react";
import { assetUrl } from "../../lib/assets.js";
import { getProfileIcon } from "../../lib/profileIcons.js";
import { getSafeImageUrl } from "../../lib/inputSecurity.js";

export function getProfileEmblemUrl(user = {}) {
  if (user.avatarSource === "discord") return getSafeImageUrl(user.discordAvatarUrl || user.discordConnection?.avatarUrl || "");
  if (user.avatarSource === "icon") {
    const icon = getProfileIcon(user.avatarIconKey);
    return icon ? getSafeImageUrl(assetUrl(icon.src)) : "";
  }
  return "";
}

export default function ProfileEmblem({ user, className = "", initial, anonymous = false }) {
  const [imageFailed, setImageFailed] = useState(false);
  const imageUrl = anonymous ? "" : getProfileEmblemUrl(user);
  const imageSource = user?.avatarSource === "icon" ? "icon" : "photo";
  const label = anonymous ? "?" : initial ?? user?.name?.slice(0, 1) ?? "?";
  const backgroundEnabled = anonymous || user?.avatarSource === "discord" || user?.avatarBackgroundEnabled !== false;
  const borderEnabled = !anonymous && user?.avatarBorderEnabled === true;
  const avatarColor = user?.avatarColor || "#58d2c0";
  const borderColor = user?.avatarBorderColor || avatarColor;

  useEffect(() => setImageFailed(false), [imageUrl, user?.avatarIconKey, user?.avatarUpdatedAt]);

  return (
    <span
      aria-hidden="true"
      className={`avatar ${imageUrl && !imageFailed ? "image-avatar" : ""} ${backgroundEnabled ? "" : "no-avatar-background"} ${borderEnabled ? "has-emblem-border" : ""} ${anonymous ? "anonymous" : ""} ${className}`.trim()}
      style={{
        "--avatar": backgroundEnabled ? avatarColor : "transparent",
        "--avatar-border": borderColor,
      }}
    >
      {label}
      {imageUrl && !imageFailed ? <img className={`profile-emblem-image ${imageSource}`} src={imageUrl} alt="" loading="lazy" decoding="async" onError={() => setImageFailed(true)} /> : null}
    </span>
  );
}
