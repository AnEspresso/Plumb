#!/usr/bin/env node
/**
 * Frame-by-frame walk recorder.
 * Each cue: screenshot + whether Ara was playing + what was pointed at + robot?
 *
 *   node scripts/tour-record.mjs
 *   node scripts/tour-record.mjs https://siteplumb.com/app/
 */
import { mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { chromium } from "playwright";

const URL = process.argv[2] || "https://siteplumb.com/app/?v=tourrecord";
const DIR = "/workspace/screenshots/tour-record";
mkdirSync(DIR, { recursive: true });

const tokenPath = "/workspace/.secrets/appcheck_debug_token";
const TOKEN = existsSync(tokenPath) ? readFileSync(tokenPath, "utf8").trim() : "";

const browser = await chromium.launch({
  headless: true,
  args: ["--no-sandbox", "--disable-dev-shm-usage", "--autoplay-policy=no-user-gesture-required"],
});
const ctx = await browser.newContext({
  viewport: { width: 390, height: 844 },
  isMobile: true,
  hasTouch: true,
  userAgent:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1",
});
if (TOKEN) {
  await ctx.addInitScript((tok) => {
    self.FIREBASE_APPCHECK_DEBUG_TOKEN = tok;
    try { localStorage.setItem("FIREBASE_APPCHECK_DEBUG_TOKEN", tok); } catch (e) {}
  }, TOKEN);
}
const page = await ctx.newPage();
await page.goto(URL, { waitUntil: "domcontentloaded", timeout: 45000 });
await page.waitForTimeout(1600);
await page.evaluate(() => {
  try { igBrowser(); sessionStorage.setItem("plumbBrowserOK", "1"); } catch (e) {}
  ["installGate", "startScrim", "setupScrim", "evScrim", "demoIntroScrim"].forEach((id) => {
    try { document.getElementById(id)?.classList.remove("show"); } catch (e) {}
  });
  try { localStorage.setItem("plumbTourMute", "0"); sessionStorage.setItem("plumbTourOffered", "1"); } catch (e) {}
});
await page.evaluate(async () => {
  try { if (typeof loadTourCues === "function") await loadTourCues(); } catch (e) {}
  try { if (typeof startTeamTour === "function") startTeamTour(); else startTour("team"); } catch (e) {}
});
await page.waitForTimeout(1400);

const rows = [];
for (let n = 0; n < 14; n++) {
  const snap = await page.evaluate(() => {
    const s = typeof _tourSteps !== "undefined" && _tourSteps && typeof _tourIdx === "number" ? _tourSteps[_tourIdx] : null;
    const a = document.querySelector("audio");
    const bub = document.getElementById("tourBubble");
    const spot = document.getElementById("tourSpot");
    let overlap = false;
    if (bub && spot) {
      const br = bub.getBoundingClientRect();
      const sr = spot.getBoundingClientRect();
      overlap = br.width && sr.width && br.left < sr.right && br.right > sr.left && br.top < sr.bottom && br.bottom > sr.top;
    }
    return {
      idx: typeof _tourIdx === "number" ? _tourIdx : -1,
      n: _tourSteps ? _tourSteps.length : 0,
      title: s ? s.title : "",
      playN: s && s.play ? s.play.length : 0,
      clip: a ? (a.currentSrc || a.src || "").split("/").pop() : "",
      paused: a ? a.paused : true,
      robot: !!(window.speechSynthesis && speechSynthesis.speaking),
      overlap,
      last: typeof _tourIdx === "number" && _tourSteps && _tourIdx >= _tourSteps.length - 1,
    };
  });
  if (snap.idx < 0) break;
  const name = String(snap.idx + 1).padStart(2, "0") + "-" + (snap.title || "slide").replace(/\s+/g, "-").toLowerCase();
  await page.screenshot({ path: `${DIR}/${name}.png` });
  rows.push(snap);
  console.log(
    snap.idx + 1 + "/" + snap.n,
    snap.title,
    "clip=" + (snap.clip || "-"),
    "robot=" + snap.robot,
    "cover=" + snap.overlap
  );
  if (snap.last) {
    await page.evaluate(() => { try { tourEnd(); } catch (e) {} });
    break;
  }
  await page.evaluate(() => { try { tourNext(); } catch (e) {} });
  await page.waitForTimeout(900);
}

const robot = rows.filter((r) => r.robot).length;
const cover = rows.filter((r) => r.overlap).length;
const report = [
  "# Walk record",
  "",
  `- slides: ${rows.length}`,
  `- robot lines heard: ${robot}`,
  `- bubble covering highlight: ${cover}`,
  "",
  ...rows.map(
    (r, i) =>
      `${i + 1}. ${r.title} · clip ${r.clip || "—"} · robot ${r.robot} · cover ${r.overlap}`
  ),
  "",
].join("\n");
writeFileSync(`${DIR}/REPORT.md`, report);
writeFileSync(`${DIR}/LOG.json`, JSON.stringify(rows, null, 2));
console.log(report);
await browser.close();
if (robot) process.exitCode = 2;
