import { execFileSync } from "node:child_process";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";

const root = process.cwd();
const sourceDir = path.join(root, "tmp", "mobile-3v3-match-flow");
const frameDir = path.join(sourceDir, "rendered");
const output = path.join(root, "public", "assets", "showcase", "mobile-3v3-match-flow.mp4");
const scenes = JSON.parse(await readFile(path.join(sourceDir, "scenes.json"), "utf8"));
const targetDuration = 59.5;
const scale = targetDuration / scenes.reduce((sum, scene) => sum + scene.duration, 0);
const ffmpeg = process.env.FFMPEG_PATH ?? "ffmpeg";

if (!frameDir.startsWith(sourceDir + path.sep)) throw new Error("잘못된 프레임 경로");
await rm(frameDir, { recursive: true, force: true });
await mkdir(frameDir, { recursive: true });
await mkdir(path.dirname(output), { recursive: true });

const clamp = (value, max) => Math.max(14, Math.min(max - 14, value));
const validPoint = (point, fallback) => point?.x > 0 && point?.y > 0 ? point : fallback;
const mix = (from, to, ratio) => ({
  x: from.x + (to.x - from.x) * ratio,
  y: from.y + (to.y - from.y) * ratio,
});
const cursorSvg = (point, from, click) => Buffer.from(`
  <svg width="430" height="932" xmlns="http://www.w3.org/2000/svg">
    <path d="M ${from.x} ${from.y} L ${point.x} ${point.y}" stroke="#ff5a43" stroke-width="4" stroke-linecap="round" opacity=".28"/>
    <circle cx="${point.x}" cy="${point.y}" r="${click ? 18 : 9}" fill="none" stroke="#ff5a43" stroke-width="3" opacity="${click ? .8 : .35}"/>
    <path d="M ${point.x} ${point.y} l 0 25 7-7 6 13 6-3-6-13 10-1 z" fill="white" stroke="#151515" stroke-width="2" stroke-linejoin="round"/>
  </svg>`);

const concat = [];
let previous = { x: 215, y: 860 };
let elapsed = 0;
let buzzerAt = 0;

for (const [sceneIndex, scene] of scenes.entries()) {
  const target = validPoint(scene.point, previous);
  target.x = clamp(target.x, 430);
  target.y = clamp(target.y, 932);
  const duration = scene.duration * scale;
  const steps = [
    { ratio: .45, duration: .12, click: false },
    { ratio: .8, duration: .12, click: false },
    { ratio: 1, duration: Math.max(.1, duration - .24), click: true },
  ];

  for (const [stepIndex, step] of steps.entries()) {
    const point = mix(previous, target, step.ratio);
    const frame = path.join(frameDir, `${String(sceneIndex + 1).padStart(2, "0")}-${stepIndex + 1}.png`);
    await sharp(scene.file).composite([{ input: cursorSvg(point, previous, step.click) }]).png().toFile(frame);
    concat.push(`file '${frame.replaceAll("\\", "/").replaceAll("'", "'\\''")}'`, `duration ${step.duration.toFixed(3)}`);
  }

  if (path.basename(scene.file).includes("clock-ended")) buzzerAt = elapsed;
  elapsed += duration;
  previous = target;
}

concat.push(concat.at(-2));
const concatFile = path.join(frameDir, "concat.txt");
await writeFile(concatFile, concat.join("\n") + "\n");

execFileSync(ffmpeg, [
  "-y", "-f", "concat", "-safe", "0", "-i", concatFile,
  "-f", "lavfi", "-t", targetDuration.toFixed(3), "-i", "anullsrc=r=48000:cl=stereo",
  "-f", "lavfi", "-i", "sine=frequency=880:duration=0.55:sample_rate=48000",
  "-filter_complex", `[2:a]adelay=${Math.round(buzzerAt * 1000)}|${Math.round(buzzerAt * 1000)},volume=.22[b];[1:a][b]amix=inputs=2:duration=first[a]`,
  "-map", "0:v:0", "-map", "[a]", "-r", "30", "-c:v", "libx264", "-preset", "medium",
  "-crf", "21", "-pix_fmt", "yuv420p", "-c:a", "aac", "-movflags", "+faststart", "-shortest", output,
], { stdio: "inherit" });

console.log(JSON.stringify({ output, width: 430, height: 932, targetDuration, scenes: scenes.length }, null, 2));
