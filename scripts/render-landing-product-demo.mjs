import { readFile, mkdir } from "node:fs/promises";
import { spawn } from "node:child_process";
import path from "node:path";

const workDir = path.resolve("tmp/landing-product-demo");
const metadata = JSON.parse(await readFile(path.join(workDir, "capture.json"), "utf8"));
const rawVideoPath = path.resolve(metadata.rawVideoPath);
const assetDir = path.resolve("public/assets/showcase");
const webmPath = path.join(assetDir, "landing-product-demo.webm");
const mp4Path = path.join(assetDir, "landing-product-demo.mp4");
const posterPath = path.join(assetDir, "landing-product-demo-poster.webp");
const transitionDuration = 0.18;

const timeline = [
  ["attendance-qr", 0.9],
  ["attendance-action", 1.2],
  ["attendance-complete", 0.8],
  ["team-action", 1.2],
  ["team-assignment", 1.2],
  ["score-actions", 2.9],
  ["scoreboard-running", 1.5],
  ["end-action", 1.2],
  ["clock-ended", 0.8],
  ["confirm-action", 1.2],
  ["final-result", 0.8],
  ["record-and-tier", 1.12],
  ["receipt-style-action", 1.2],
  ["verified-receipt", 3.32],
];

function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: "inherit" });
    child.on("error", reject);
    child.on("exit", (code) => code === 0 ? resolve() : reject(new Error(`${command} 종료 코드 ${code}`)));
  });
}

const segments = timeline.map(([name, duration], index) => {
  const scene = metadata.scenes.find((item) => item.name === name);
  if (!scene) throw new Error(`캡처 장면 누락: ${name}`);
  if (scene.duration < duration) throw new Error(`캡처 장면 길이 부족: ${name}`);
  return `[0:v]trim=start=${scene.start}:duration=${duration},setpts=PTS-STARTPTS,` +
    `fps=30,scale=1080:1920:flags=lanczos,setsar=1,format=yuv420p,settb=1/30[v${index}]`;
});
const transitions = [];
let transitionInput = "[v0]";
let combinedDuration = timeline[0][1];
for (let index = 1; index < timeline.length; index += 1) {
  const output = `[x${index}]`;
  const offset = combinedDuration - transitionDuration;
  transitions.push(
    `${transitionInput}[v${index}]xfade=transition=fade:duration=${transitionDuration}:offset=${offset.toFixed(2)}${output}`,
  );
  transitionInput = output;
  combinedDuration += timeline[index][1] - transitionDuration;
}
const filter = `${segments.join(";")};${transitions.join(";")};` +
  `${transitionInput}tpad=stop_mode=clone:stop_duration=0.25,` +
  "trim=end_frame=511,fps=30,settb=expr=1/30,setpts=N,format=yuv420p[outv]";

await mkdir(assetDir, { recursive: true });
await run("ffmpeg", [
  "-y", "-i", rawVideoPath,
  "-filter_complex", filter,
  "-map", "[outv]", "-an",
  "-c:v", "libvpx-vp9", "-crf", "38", "-b:v", "0",
  "-deadline", "good", "-cpu-used", "2", "-row-mt", "1",
  webmPath,
]);
await run("ffmpeg", [
  "-y", "-i", rawVideoPath,
  "-filter_complex", filter,
  "-map", "[outv]", "-an",
  "-c:v", "libx264", "-preset", "medium", "-crf", "24",
  "-pix_fmt", "yuv420p", "-movflags", "+faststart",
  mp4Path,
]);
await run("ffmpeg", [
  "-y", "-ss", "14.2", "-i", mp4Path,
  "-frames:v", "1", "-c:v", "libwebp", "-quality", "82",
  posterPath,
]);

console.log(JSON.stringify({ webmPath, mp4Path, posterPath, duration: 17 }, null, 2));
