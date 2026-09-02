import { readFile, mkdir } from "node:fs/promises";
import { spawn } from "node:child_process";
import path from "node:path";

const workDir = path.resolve("tmp/landing-product-demo");
const metadata = JSON.parse(await readFile(path.join(workDir, "capture.json"), "utf8"));
const rawVideoPath = path.resolve(metadata.rawVideoPath);
const receiptAssetPath = path.resolve(metadata.receiptAssetPath);
const assetDir = path.resolve("public/assets/showcase");
const webmPath = path.join(assetDir, "landing-product-demo.webm");
const mp4Path = path.join(assetDir, "landing-product-demo.mp4");
const posterPath = path.join(assetDir, "landing-product-demo-poster.webp");
const transitionDuration = 0.22;
const legacyCaptionCorrection = metadata.captionAccentRemoved === true
  ? ""
  : "delogo=x=8:y=8:w=18:h=86:show=0,";

const timeline = [
  ["create-match", 7.5],
  ["tier-match", 6.2],
  ["region-filter", 6.0],
  ["attendance", 8.0],
  ["team-assignment", 5.7],
  ["live-scoreboard", 8.6],
  ["final-result", 5.3],
  ["tier-update", 6.5],
  ["receipt-entry", 5.0],
  ["thermal-receipt", 3.6, "receipt"],
];

function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: "inherit" });
    child.on("error", reject);
    child.on("exit", (code) => code === 0 ? resolve() : reject(new Error(`${command} 종료 코드 ${code}`)));
  });
}

const segments = timeline.map(([name, duration, source = "video"], index) => {
  if (source === "receipt") {
    return `[1:v]trim=duration=${duration},setpts=PTS-STARTPTS,` +
      "fps=30,scale=1080:1920:force_original_aspect_ratio=decrease:flags=lanczos," +
      "pad=1080:1920:(ow-iw)/2:(oh-ih)/2:color=#eeede7,setsar=1,format=yuv420p,settb=1/30" +
      `[v${index}]`;
  }
  const scene = metadata.scenes.find((item) => item.name === name);
  if (!scene) throw new Error(`캡처 장면 누락: ${name}`);
  if (scene.duration < duration) throw new Error(`캡처 장면 길이 부족: ${name}`);
  return `[0:v]trim=start=${scene.start}:duration=${duration},setpts=PTS-STARTPTS,` +
    legacyCaptionCorrection +
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
  `trim=duration=${(combinedDuration + 0.25).toFixed(3)},` +
  "fps=30,settb=expr=1/30,setpts=N/(30*TB),format=yuv420p[outv]";

await mkdir(assetDir, { recursive: true });
await run("ffmpeg", [
  "-y", "-i", rawVideoPath, "-loop", "1", "-framerate", "30", "-i", receiptAssetPath,
  "-filter_complex", filter,
  "-map", "[outv]", "-an",
  "-c:v", "libvpx-vp9", "-crf", "38", "-b:v", "0",
  "-deadline", "good", "-cpu-used", "2", "-row-mt", "1",
  webmPath,
]);
await run("ffmpeg", [
  "-y", "-i", rawVideoPath, "-loop", "1", "-framerate", "30", "-i", receiptAssetPath,
  "-filter_complex", filter,
  "-map", "[outv]", "-an",
  "-c:v", "libx264", "-preset", "medium", "-crf", "24",
  "-pix_fmt", "yuv420p", "-movflags", "+faststart",
  mp4Path,
]);
await run("ffmpeg", [
  "-y", "-ss", (combinedDuration - 3.8).toFixed(2), "-i", mp4Path,
  "-frames:v", "1", "-c:v", "libwebp", "-quality", "82",
  posterPath,
]);

console.log(JSON.stringify({
  webmPath,
  mp4Path,
  posterPath,
  duration: Number((combinedDuration + 0.25).toFixed(3)),
}, null, 2));
