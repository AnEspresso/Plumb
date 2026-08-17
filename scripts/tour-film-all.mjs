#!/usr/bin/env node
/** Four window sizes. Still Chromium — not real Safari / Android.
 *   node scripts/tour-film-all.mjs https://siteplumb.com/app/
 */
import { spawn } from "node:child_process";

const URL = process.argv[2] || "https://siteplumb.com/app/?v=film4";
for (const kind of ["iphone", "android", "mac", "pc"]) {
  console.log("\n===", kind, "===");
  await new Promise((res, rej) => {
    const p = spawn("node", ["/workspace/siteplumb/scripts/tour-film.mjs", URL, kind], { stdio: "inherit" });
    p.on("exit", (c) => (c === 0 ? res() : rej(new Error(kind + " " + c))));
  });
}
