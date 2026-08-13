import { readFile } from "node:fs/promises";
import { extname, resolve } from "node:path";

const RECEIPT_ASSETS = [
  "public/assets/rankball-record-create-night-v5.webp",
  "public/assets/rankball-record-create-night-v3.webp",
  "public/assets/rankball-record-create-night-v2.webp",
  "public/assets/match-receipt-paper-torn-v1.png",
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
  "public/assets/tier-emblems/tier-neutral-home-outline-v4.png",
  "public/assets/tier-emblems/tier-neutral-away-outline-v4.png",
];

const CONTENT_TYPES = new Map([
  [".png", "image/png"],
  [".svg", "image/svg+xml"],
  [".webp", "image/webp"],
]);

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
  const response = await fetch(
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

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`receipt_r2_sync_failed:${objectKey}:${response.status}:${detail}`);
  }

  console.log(`Receipt R2 synced: ${objectKey}`);
}
