import { readFile } from "node:fs/promises";
import { extname, resolve } from "node:path";

const RECEIPT_ASSETS = [
  "public/assets/rankball-record-create-night-v10.webp",
  "public/assets/rankball-record-create-night-v9.webp",
  "public/assets/rankball-record-create-night-v3.webp",
  "public/assets/rankball-record-create-night-v2.webp",
  "public/assets/match-receipt-paper-torn-v1.png",
  "public/assets/match-receipt-paper-grain-v1.png",
  "public/assets/match-receipt-score-digits-v3.png",
  "public/assets/match-receipt-scoreboard-digits-v1.png",
  "public/assets/match-receipt-scoreboard-digits-v2.png",
  "public/assets/match-receipt-wordmark-v1.png",
  "public/assets/tier-emblems/tier-rookie-outline-v1.png",
  "public/assets/tier-emblems/tier-bronze-outline-v1.png",
  "public/assets/tier-emblems/tier-silver-outline-v1.png",
  "public/assets/tier-emblems/tier-gold-outline-v1.png",
  "public/assets/tier-emblems/tier-platinum-outline-v1.png",
  "public/assets/tier-emblems/tier-diamond-outline-v1.png",
  "public/assets/tier-emblems/tier-master-outline-v1.png",
  "public/assets/tier-emblems/tier-legend-outline-v1.png",
  "public/assets/tier-emblems/tier-neutral-outline-v1.svg",
  "public/assets/tier-emblems/tier-neutral-outline-v2.png",
  "public/assets/tier-emblems/tier-neutral-home-outline-v5.png",
  "public/assets/tier-emblems/tier-neutral-away-outline-v5.png",
];

const CONTENT_TYPES = new Map([
  [".png", "image/png"],
  [".svg", "image/svg+xml"],
  [".webp", "image/webp"],
]);
const R2_UPLOAD_MAX_ATTEMPTS = 3;
const R2_UPLOAD_RETRY_BASE_DELAY_MS = 750;

if (process.env.VERCEL_ENV !== "production") {
  console.log("Receipt R2 sync skipped outside production.");
  process.exit(0);
}

const accountId = String(process.env.CLOUDFLARE_ACCOUNT_ID || "").trim();
const apiToken = String(
  process.env.CLOUDFLARE_R2_API_TOKEN || process.env.CLOUDFLARE_API_TOKEN || "",
).trim();
const bucket = String(process.env.CLOUDFLARE_R2_BUCKET || "").trim();

if (!accountId || !apiToken || !bucket) {
  throw new Error("receipt_r2_sync_not_configured");
}

for (const file of RECEIPT_ASSETS) {
  const objectKey = file.replace(/^public\//, "");
  const encodedKey = objectKey.split("/").map(encodeURIComponent).join("/");
  const bytes = await readFile(resolve(file));
  let response;

  for (let attempt = 1; attempt <= R2_UPLOAD_MAX_ATTEMPTS; attempt += 1) {
    response = await fetch(
      `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(accountId)}/r2/buckets/${encodeURIComponent(bucket)}/objects/${encodedKey}`,
      {
        method: "PUT",
        headers: {
          Authorization: `Bearer ${apiToken}`,
          "Cache-Control": "public, max-age=31536000, immutable",
          "Content-Type": CONTENT_TYPES.get(extname(file)) || "application/octet-stream",
        },
        body: bytes,
      },
    );

    if (response.ok) break;

    const detail = await response.text();
    const retryable = response.status === 429 || response.status >= 500;
    if (!retryable || attempt === R2_UPLOAD_MAX_ATTEMPTS) {
      throw new Error(`receipt_r2_sync_failed:${objectKey}:${response.status}:${detail}`);
    }

    console.warn(`Receipt R2 retry ${attempt}/${R2_UPLOAD_MAX_ATTEMPTS - 1}: ${objectKey} (${response.status})`);
    await new Promise((resolveDelay) => {
      setTimeout(resolveDelay, R2_UPLOAD_RETRY_BASE_DELAY_MS * attempt);
    });
  }

  console.log(`Receipt R2 synced: ${objectKey}`);
}
