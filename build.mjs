// 建置：把 src/app.jsx（含 React）打包成 app.js，並依內容更新 service worker 的快取名稱
// 用法：npm install（第一次）→ npm run build
import { build } from "esbuild";
import { readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";

await build({
  entryPoints: ["src/app.jsx"],
  bundle: true,
  minify: true,
  format: "iife",
  target: ["es2019", "safari13"],
  jsx: "automatic",
  define: { "process.env.NODE_ENV": '"production"' },
  outfile: "app.js",
  logLevel: "info",
});

const hash = createHash("sha256");
for (const f of ["app.js", "styles.css", "index.html", "manifest.json"]) hash.update(readFileSync(f));
const tag = hash.digest("hex").slice(0, 10);
const sw = readFileSync("service-worker.js", "utf8").replace(/const CACHE_NAME = "habit-hourglass-[^"]*";/, `const CACHE_NAME = "habit-hourglass-${tag}";`);
writeFileSync("service-worker.js", sw);
console.log(`service-worker 快取名稱：habit-hourglass-${tag}`);
