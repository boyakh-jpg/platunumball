import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";

const ROOT = resolve(import.meta.dirname, "..");
const SERVER_FILES = [
  "server/api/_authoritativeState.js",
];

test("서버의 repository bridge는 호환 배럴 대신 소유 모듈만 직접 읽는다", async () => {
  const [adapterSource, ...consumerSources] = await Promise.all([
    readFile(resolve(ROOT, "server/lib/repositoryAdapter.js"), "utf8"),
    ...SERVER_FILES.map((file) => readFile(resolve(ROOT, file), "utf8")),
  ]);

  assert.doesNotMatch(adapterSource, /src\/data\/repository\.js/u);
  assert.match(adapterSource, /src\/data\/repository\/runtime\.js/u);
  assert.match(adapterSource, /src\/data\/repository\/recruiting\/confirmation\.js/u);
  assert.match(adapterSource, /src\/data\/repository\/matchCreation\.js/u);
  assert.match(adapterSource, /src\/data\/repository\/remote\/stateLoader\.js/u);
  consumerSources.forEach((source) => {
    assert.match(source, /server\/lib\/repositoryAdapter|lib\/repositoryAdapter/u);
    assert.doesNotMatch(source, /src\/data\/repository\.js/u);
  });
});

test("adapter 밖의 서버 파일은 repository를 직접 역참조하지 않는다", async () => {
  const { readdir } = await import("node:fs/promises");
  const files = [];
  const visit = async (directory) => {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = resolve(directory, entry.name);
      if (entry.isDirectory()) await visit(path);
      else if (entry.isFile() && entry.name.endsWith(".js")) files.push(path);
    }
  };
  await visit(resolve(ROOT, "server"));

  const offenders = [];
  for (const file of files) {
    if (file.endsWith("server\\lib\\repositoryAdapter.js") || file.endsWith("server/lib/repositoryAdapter.js")) continue;
    const source = await readFile(file, "utf8");
    if (/src\/data\/repository\.js/u.test(source)) offenders.push(file);
  }
  assert.deepEqual(offenders, []);
});
