export const PROFILE_ICON_CATALOG = Object.freeze([
  Object.freeze({
    id: "01-first-bucket",
    name: "첫 득점",
    description: "모든 플레이어에게 기본 제공",
    src: "/assets/profile-icons/01-first-bucket.png",
    unlocked: true,
  }),
]);

export function getProfileIcon(iconId = "") {
  return PROFILE_ICON_CATALOG.find((icon) => icon.id === String(iconId || "").trim()) ?? null;
}

export function isSelectableProfileIcon(iconId = "") {
  return getProfileIcon(iconId)?.unlocked === true;
}
