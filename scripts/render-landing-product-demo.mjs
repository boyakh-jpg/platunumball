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

const timeline = [
  ["attendance-qr", 0.9],
  ["attendance-complete", 0.7],
  ["team-assignment", 1.4],
  ["scoreboard-running", 2.5],
  ["record-and-tier", 1.5],
  ["clock-ended", 1.0],
  ["final-result", 1.0],
  ["verified-receipt", 3.0],
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
    `fps=30,scale=1080:1920:flags=lanczos,setsar=1,format=yuv420p[v${index}]`;
});
const inputs = timeline.map((_, index) => `[v${index}]`).join("");
const filter = `${segments.join(";")};${inputs}concat=n=${timeline.length}:v=1:a=0[concatv];` +
  "[concatv]trim=end_frame=360,settb=expr=1/30,setpts=N[outv]";

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
  "-y", "-ss", "9.2", "-i", mp4Path,
  "-frames:v", "1", "-c:v", "libwebp", "-quality", "82",
  posterPath,
]);

console.log(JSON.stringify({ webmPath, mp4Path, posterPath, duration: 12 }, null, 2));
