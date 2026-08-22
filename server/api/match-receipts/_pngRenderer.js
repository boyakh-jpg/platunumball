import path from "node:path";
import { validatePreparedReceiptEmblem } from "./_emblemStorage.js";
import { MATCH_RECEIPT_STYLES } from "../../../shared/lib/thermalReceipt.js";

export const MATCH_RECEIPT_RENDER_PRESETS = Object.freeze({ story: "story", feed: "feed" });

const STORY_WIDTH = 1080;
const STORY_HEIGHT = 1920;
const FEED_HEIGHT = 1350;
const GOLD = "#d6a522";
const CREAM = "#f5eddc";
const INK = "#15130f";
const TEXT_FONT = path.join(process.cwd(), "public", "assets", "fonts", "PretendardVariable.woff2");
const DISPLAY_FONT = path.join(process.cwd(), "public", "assets", "fonts", "BlackHanSans-Regular.ttf");

function markup(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function textLayer(value, options = {}) {
  if (!String(value ?? "").trim()) return null;
  const width = Math.max(1, Math.round(options.width ?? 400));
  const height = Math.max(1, Math.round(options.height ?? 80));
  const size = Math.max(8, Math.round(options.size ?? 32));
  const weight = options.weight ?? 600;
  const color = options.color ?? CREAM;
  return {
    input: {
      text: {
        text: `<span foreground="${color}" weight="${weight}" font_size="${size * 1024}">${markup(value)}</span>`,
        fontfile: options.display ? DISPLAY_FONT : TEXT_FONT,
        width,
        height,
        align: options.align ?? "left",
        rgba: true,
        wrap: "char",
      },
    },
    left: Math.round(options.left ?? 0),
    top: Math.round(options.top ?? 0),
  };
}

function getResult(draft) {
  if (draft.homeScore === draft.awayScore) return "DRAW";
  const winner = draft.homeScore > draft.awayScore ? draft.homeTeam : draft.awayTeam;
  const loser = draft.homeScore > draft.awayScore ? draft.awayTeam : draft.homeTeam;
  return `WIN ${winner} · LOSS ${loser}`;
}

function getPeriodText(draft) {
  if (!draft.periodScores?.length) return "";
  return draft.periodScores
    .map((period) => `${period.label}  ${period.scoreA}-${period.scoreB}`)
    .join("     ");
}

async function prepareEmblem(sharp, emblem, style) {
  if (!emblem) return null;
  const normalized = await validatePreparedReceiptEmblem(emblem.imageBase64);
  let pipeline = sharp(normalized.bytes)
    .resize(180, 180, { fit: "contain", position: "centre", background: { r: 0, g: 0, b: 0, alpha: 0 } });
  if (style === MATCH_RECEIPT_STYLES.thermal) pipeline = pipeline.grayscale();
  return pipeline.png().toBuffer();
}

function createScoreBackground() {
  return Buffer.from(`<svg width="1080" height="1920" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <linearGradient id="bg" x1="0" y1="0" x2="0" y2="1"><stop stop-color="#221d16"/><stop offset="0.48" stop-color="#080808"/><stop offset="1" stop-color="#16110a"/></linearGradient>
      <pattern id="grain" width="18" height="18" patternUnits="userSpaceOnUse"><circle cx="2" cy="4" r="1" fill="#fff" opacity=".035"/><circle cx="13" cy="12" r="1" fill="#d6a522" opacity=".05"/></pattern>
    </defs>
    <rect width="1080" height="1920" fill="url(#bg)"/><rect width="1080" height="1920" fill="url(#grain)"/>
    <path d="M0 140 L1080 65 L1080 105 L0 180Z" fill="#d6a522" opacity=".9"/>
    <rect x="72" y="270" width="936" height="3" fill="#d6a522" opacity=".75"/>
    <rect x="72" y="1450" width="936" height="350" rx="10" fill="#f5eddc"/>
    <path d="M72 1450 L125 1431 174 1451 227 1434 278 1450 333 1430 386 1451 438 1433 493 1450 548 1431 603 1451 658 1433 714 1450 769 1430 824 1451 880 1433 936 1450 1008 1432V1468H72Z" fill="#f5eddc"/>
    <circle cx="303" cy="710" r="182" fill="none" stroke="#d6a522" stroke-width="3" opacity=".18"/><circle cx="777" cy="710" r="182" fill="none" stroke="#d6a522" stroke-width="3" opacity=".18"/>
    <rect x="528" y="510" width="24" height="420" fill="#d6a522" opacity=".12"/>
  </svg>`);
}

function createThermalBackground() {
  return Buffer.from(`<svg width="1080" height="1920" xmlns="http://www.w3.org/2000/svg">
    <defs><pattern id="paper" width="22" height="22" patternUnits="userSpaceOnUse"><circle cx="3" cy="5" r="1" fill="#777" opacity=".09"/><path d="M10 18h7" stroke="#777" opacity=".05"/></pattern></defs>
    <rect width="1080" height="1920" fill="#4a4a4a"/><path d="M142 75 L176 61 208 78 243 62 276 77 310 61 346 78 382 62 418 77 454 61 490 78 526 62 562 77 598 61 634 78 670 62 706 77 742 61 778 78 814 62 850 77 886 61 922 78 938 72 V1840 L902 1855 868 1839 833 1856 798 1839 762 1855 726 1839 690 1856 654 1839 618 1855 582 1839 546 1856 510 1839 474 1855 438 1839 402 1856 366 1839 330 1855 294 1839 258 1856 222 1839 186 1855 142 1840Z" fill="#efefeb"/>
    <rect x="142" y="75" width="796" height="1765" fill="url(#paper)"/>
    <g stroke="#242424" stroke-width="3" stroke-dasharray="10 8"><path d="M198 300H882"/><path d="M198 1010H882"/><path d="M198 1390H882"/></g>
    <rect x="198" y="410" width="684" height="420" fill="none" stroke="#242424" stroke-width="4"/>
    <path d="M540 410V830" stroke="#242424" stroke-width="3"/><path d="M198 610H882" stroke="#242424" stroke-width="3"/>
  </svg>`);
}

async function renderStory(sharp, draft, emblems) {
  const thermal = draft.receiptStyle === MATCH_RECEIPT_STYLES.thermal;
  const layers = [];
  const homeEmblem = await prepareEmblem(sharp, emblems.home, draft.receiptStyle);
  const awayEmblem = await prepareEmblem(sharp, emblems.away, draft.receiptStyle);
  if (thermal) {
    layers.push(
      textLayer("BOXTIER / MATCH RECEIPT", { left: 198, top: 145, width: 684, height: 70, size: 38, color: INK, weight: 800, align: "center" }),
      textLayer(`${draft.playedOn}  ${draft.playedTime}`, { left: 198, top: 224, width: 684, height: 44, size: 23, color: INK, align: "center" }),
      textLayer(draft.homeTeam, { left: 218, top: 445, width: 302, height: 70, size: 34, color: INK, weight: 800, align: "center" }),
      textLayer(draft.awayTeam, { left: 560, top: 445, width: 302, height: 70, size: 34, color: INK, weight: 800, align: "center" }),
      textLayer(String(draft.homeScore), { left: 218, top: 635, width: 302, height: 145, size: 100, color: INK, weight: 900, align: "center", display: true }),
      textLayer(String(draft.awayScore), { left: 560, top: 635, width: 302, height: 145, size: 100, color: INK, weight: 900, align: "center", display: true }),
      textLayer("VS", { left: 490, top: 575, width: 100, height: 50, size: 26, color: INK, weight: 800, align: "center" }),
      textLayer(`COURT   ${draft.venue}`, { left: 198, top: 875, width: 684, height: 45, size: 25, color: INK }),
      textLayer(`FORMAT  ${draft.format}    TYPE  ${draft.matchNature.toUpperCase()}`, { left: 198, top: 930, width: 684, height: 45, size: 24, color: INK }),
      textLayer(getPeriodText(draft) || "FINAL SCORE", { left: 198, top: 1070, width: 684, height: 95, size: 24, color: INK, align: "center" }),
      textLayer(getResult(draft), { left: 198, top: 1215, width: 684, height: 85, size: 36, color: INK, weight: 900, align: "center" }),
      textLayer(draft.receiptComment || draft.comment || "", { left: 198, top: 1305, width: 684, height: 54, size: 22, color: INK, align: "center" }),
      textLayer(draft.tournamentName || "BOXTIER BASKETBALL", { left: 198, top: 1460, width: 684, height: 65, size: 30, color: INK, weight: 800, align: "center" }),
      textLayer("NO CLOUD STORAGE · API GENERATED", { left: 198, top: 1710, width: 684, height: 45, size: 18, color: INK, align: "center" }),
    );
    if (homeEmblem) layers.push({ input: homeEmblem, left: 279, top: 505 });
    if (awayEmblem) layers.push({ input: awayEmblem, left: 621, top: 505 });
  } else {
    layers.push(
      textLayer("BOXTIER", { left: 72, top: 175, width: 520, height: 92, size: 68, color: CREAM, weight: 900, display: true }),
      textLayer(getResult(draft), { left: 72, top: 285, width: 936, height: 52, size: 25, color: GOLD, weight: 800 }),
      textLayer(draft.tournamentName || "MATCH RECEIPT", { left: 72, top: 355, width: 936, height: 70, size: 38, color: CREAM, weight: 800, align: "center" }),
      textLayer(draft.homeTeam, { left: 90, top: 855, width: 420, height: 110, size: 48, color: CREAM, weight: 900, align: "center" }),
      textLayer(draft.awayTeam, { left: 570, top: 855, width: 420, height: 110, size: 48, color: CREAM, weight: 900, align: "center" }),
      textLayer(String(draft.homeScore), { left: 82, top: 560, width: 430, height: 250, size: 170, color: CREAM, weight: 900, align: "center", display: true }),
      textLayer(String(draft.awayScore), { left: 568, top: 560, width: 430, height: 250, size: 170, color: CREAM, weight: 900, align: "center", display: true }),
      textLayer("—", { left: 500, top: 625, width: 80, height: 80, size: 52, color: GOLD, weight: 900, align: "center" }),
      textLayer(getPeriodText(draft), { left: 90, top: 1050, width: 900, height: 100, size: 25, color: GOLD, align: "center" }),
      textLayer(`${draft.format} · ${draft.matchNature.toUpperCase()}`, { left: 110, top: 1170, width: 860, height: 70, size: 35, color: CREAM, weight: 800, align: "center" }),
      textLayer(draft.comment || "", { left: 110, top: 1260, width: 860, height: 70, size: 30, color: CREAM, align: "center" }),
      textLayer(draft.venue, { left: 118, top: 1515, width: 600, height: 75, size: 34, color: INK, weight: 800 }),
      textLayer(`${draft.playedOn}  ${draft.playedTime}`, { left: 118, top: 1610, width: 600, height: 52, size: 27, color: INK }),
      textLayer(`${draft.format} / ${draft.matchNature.toUpperCase()}`, { left: 118, top: 1680, width: 600, height: 52, size: 25, color: INK }),
      textLayer("API PNG", { left: 760, top: 1540, width: 190, height: 70, size: 35, color: GOLD, weight: 900, align: "center" }),
      textLayer("STATELESS", { left: 760, top: 1630, width: 190, height: 45, size: 20, color: INK, weight: 800, align: "center" }),
    );
    if (homeEmblem) layers.push({ input: homeEmblem, left: 210, top: 930 });
    if (awayEmblem) layers.push({ input: awayEmblem, left: 690, top: 930 });
  }

  let result = sharp(thermal ? createThermalBackground() : createScoreBackground())
    .composite(layers.filter(Boolean))
    .png({ compressionLevel: 9 });
  if (thermal) result = result.grayscale().png({ palette: true, colours: 4, dither: 0.8, compressionLevel: 9 });
  return result.toBuffer();
}

export async function renderMatchReceiptPng({ draft, emblems = {}, preset = MATCH_RECEIPT_RENDER_PRESETS.story }) {
  const { default: sharp } = await import("sharp");
  const story = await renderStory(sharp, draft, emblems);
  if (preset === MATCH_RECEIPT_RENDER_PRESETS.story) return story;
  const fittedWidth = Math.round(STORY_WIDTH * FEED_HEIGHT / STORY_HEIGHT);
  const receipt = await sharp(story).resize(fittedWidth, FEED_HEIGHT, { fit: "fill" }).toBuffer();
  let result = sharp({ create: { width: STORY_WIDTH, height: FEED_HEIGHT, channels: 4, background: "#090909" } })
    .composite([{ input: receipt, left: Math.round((STORY_WIDTH - fittedWidth) / 2), top: 0 }])
    .png({ compressionLevel: 9 });
  if (draft.receiptStyle === MATCH_RECEIPT_STYLES.thermal) {
    result = result.grayscale().png({ palette: true, colours: 4, dither: 0.8, compressionLevel: 9 });
  }
  return result.toBuffer();
}
