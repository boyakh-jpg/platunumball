import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("브랜드 이미지와 fallback 마크업은 BrandLockup 한 곳만 소유한다", async () => {
  const sources = await Promise.all([
    "src/components/common/BrandLockup.jsx",
    "src/pages/Login.jsx",
    "src/components/layout/Sidebar.jsx",
    "src/pages/VisualDirectionDemo.jsx",
  ].map((file) => readFile(new URL(`../${file}`, import.meta.url), "utf8")));
  const [lockupSource, ...consumerSources] = sources;

  assert.match(lockupSource, /BOXTIER_LOGO_URL/);
  assert.match(lockupSource, /showBrandLetterFallback/);
  consumerSources.forEach((source) => {
    assert.match(source, /<BrandLockup\s*\/>/);
    assert.doesNotMatch(source, /brand-letter-fallback/);
    assert.doesNotMatch(source, /BOXTIER_LETTER_(?:DARK|LIGHT)_URL/);
  });
});
