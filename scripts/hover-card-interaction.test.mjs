import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);

async function readSource(path) {
  return readFile(new URL(path, root), "utf8");
}

const hoverCardPaths = [
  "src/components/court/CourtHoverCard.jsx",
  "src/components/profile/PlayerHoverCard.jsx",
  "src/components/referee/RefereeHoverCard.jsx",
  "src/components/team/TeamHoverCard.jsx",
];

test("entity hover cards use one shared interaction hook", async () => {
  const [hoverPortal, ...sources] = await Promise.all([
    readSource("src/components/common/HoverPortal.jsx"),
    ...hoverCardPaths.map(readSource),
  ]);

  sources.forEach((source) => {
    assert.match(source, /import useHoverCardInteraction from "\.\.\/\.\.\/hooks\/useHoverCardInteraction\.js";/);
    assert.match(source, /HoverCardCloseButton, HoverCardTrigger/);
    assert.match(source, /useHoverCardInteraction\(\{ cardKey(?:, longPress: true)? \}\)/);
    assert.match(source, /<HoverCardTrigger/);
    assert.match(source, /<HoverCardCloseButton onClose=\{closePinned\} \/>/);
    assert.doesNotMatch(source, /className="hover-card-close"/);
    assert.doesNotMatch(source, /event\.key === "Enter" \|\| event\.key === " "/);
    assert.doesNotMatch(source, /subscribePinnedHoverPreview|document\.addEventListener\("pointerdown"|useBodyScrollLock/);
  });
  assert.match(hoverPortal, /export function HoverCardTrigger/);
  assert.match(hoverPortal, /export function HoverCardCloseButton/);
  assert.match(hoverPortal, /if \(event\.target !== event\.currentTarget\) return;/);
  assert.match(hoverPortal, /event\.key === "Escape"/);
  assert.match(hoverPortal, /event\.key === "Enter" \|\| event\.key === " "/);
  assert.equal((hoverPortal.match(/className="[^"]*\bhover-card-close\b[^"]*"/g) ?? []).length, 1);
});

test("shared hover interaction owns pin, dismiss, scroll lock, and long press", async () => {
  const source = await readSource("src/hooks/useHoverCardInteraction.js");

  assert.match(source, /const LONG_PRESS_DELAY_MS = 420;/);
  assert.match(source, /useBodyScrollLock\(pinnedOpen\);/);
  assert.match(source, /subscribePinnedHoverPreview\(setPinnedHoverKey\)/);
  assert.match(source, /pinnedHoverKey !== cardKey/);
  assert.match(source, /anchorRef\.current\?\.contains\(target\) \|\| cardRef\.current\?\.contains\(target\)/);
  assert.match(source, /document\.addEventListener\("pointerdown", closeOutside, true\);/);
  assert.match(source, /document\.addEventListener\("keydown", closeOnEscape\);/);
  assert.match(source, /if \(event\.key === "Escape"\) closePinned\(\);/);
  assert.match(source, /isTouchPreviewEvent\(event\)/);
  assert.match(source, /longPressTimerRef\.current = window\.setTimeout/);
});

test("player and team keep long press while court and referee keep tap toggle", async () => {
  const [court, player, referee, team] = await Promise.all(hoverCardPaths.map(readSource));

  assert.match(player, /useHoverCardInteraction\(\{ cardKey, longPress: true \}\)/);
  assert.match(team, /useHoverCardInteraction\(\{ cardKey, longPress: true \}\)/);
  assert.match(player, /consumeLongPressOpen\(\)/);
  assert.match(team, /consumeLongPressOpen\(\)/);

  assert.match(court, /useHoverCardInteraction\(\{ cardKey \}\)/);
  assert.match(referee, /useHoverCardInteraction\(\{ cardKey \}\)/);
  assert.match(court, /onActivate=\{togglePinned\}/);
  assert.match(referee, /onActivate=\{togglePinned\}/);
});

test("matching host and court actions do not fall through to the room card", async () => {
  const [recruiting, room, court, disclosure] = await Promise.all([
    readSource("src/pages/RecruitingPageView.jsx"),
    readSource("src/components/recruiting/RecruitingRoomPrimarySection.jsx"),
    readSource("src/components/court/CourtHoverCard.jsx"),
    readSource("src/styles/primitives/hover-disclosure.css"),
  ]);

  assert.match(recruiting, /<PlayerHoverCard user=\{host\} teams=\{app\.state\.teams\}>/);
  assert.doesNotMatch(recruiting, /<PlayerHoverCard user=\{host\} teams=\{app\.state\.teams\} as="span">/);
  assert.match(recruiting, /courtId=\{post\.courtId\}/);
  assert.match(room, /courtId=\{selectedPost\.courtId\}/);
  assert.match(court, /상세 프로필 보기/);
  assert.match(court, /지도 보기/);
  assert.match(disclosure, /grid-template-columns: repeat\(2, minmax\(0, 1fr\)\);/);
  assert.match(disclosure, /\.hover-card-action:only-child \{\s*grid-column: 1 \/ -1;/);
});
