#!/usr/bin/env node
/**
 * Visual pass: every cue gets a screenshot + cover/miss/huge report.
 *
 *   node scripts/tour-see.mjs
 *   node scripts/tour-see.mjs https://siteplumb.com/app/
 */
import { mkdirSync, writeFileSync, rmSync, readFileSync, existsSync } from "node:fs";
import { chromium } from "playwright";

const URL = process.argv[2] || "http://127.0.0.1:8765/app/index.html?v=see";
const DIR = "/workspace/screenshots/tour-see";
rmSync(DIR, { recursive: true, force: true });
mkdirSync(DIR, { recursive: true });
const TOKEN = existsSync("/workspace/.secrets/appcheck_debug_token")
  ? readFileSync("/workspace/.secrets/appcheck_debug_token", "utf8").trim()
  : "";

const browser = await chromium.launch({
  headless: true,
  args: ["--no-sandbox", "--disable-dev-shm-usage", "--autoplay-policy=no-user-gesture-required"],
});
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
if (TOKEN) {
  await ctx.addInitScript((tok) => {
    self.FIREBASE_APPCHECK_DEBUG_TOKEN = tok;
    try { localStorage.setItem("FIREBASE_APPCHECK_DEBUG_TOKEN", tok); } catch (e) {}
  }, TOKEN);
}
const page = await ctx.newPage();
await page.goto(URL, { waitUntil: "domcontentloaded", timeout: 45000 });
await page.waitForTimeout(1200);
await page.evaluate(async () => {
  try { igBrowser(); sessionStorage.setItem("plumbBrowserOK", "1"); } catch (e) {}
  ["installGate", "startScrim", "setupScrim", "evScrim", "demoIntroScrim"].forEach((id) => {
    try { document.getElementById(id)?.classList.remove("show"); } catch (e) {}
  });
  try {
    sessionStorage.setItem("plumbTourOffered", "1");
    localStorage.setItem("plumbTourMute", "1");
    localStorage.setItem("plumbTourHud", "1");
  } catch (e) {}
  try { enterDemo(); document.getElementById("demoIntroScrim")?.classList.remove("show"); } catch (e) {}
  try { if (typeof loadTourCues === "function") await loadTourCues(); } catch (e) {}
  window.tourPlayFile = function (name) {
    return new Promise(function (r) { setTimeout(r, 280); });
  };
  window.tourWaitTap = function () { return Promise.resolve(); };
  try { showOverview(); renderToday(); renderOvCards(); startTour("team"); } catch (e) {}
});
await page.waitForTimeout(500);

const seen = [];
let last = 0;
for (let i = 0; i < 80; i++) {
  const snap = await page.evaluate(() => {
    const see = window.__tourSee || [];
    return {
      n: see.length,
      last: see[see.length - 1] || null,
      bubble: !!document.getElementById("tourBubble"),
    };
  });
  if (snap.n > last && snap.last) {
    const row = snap.last;
    const tag = (row.cue || "x") + "-" + (row.covers && row.covers.length ? "COVER" : row.huge ? "HUGE" : row.miss ? "MISS" : "ok");
    await page.screenshot({ path: `${DIR}/${String(seen.length).padStart(2, "0")}-${tag}.png` });
    seen.push(row);
    console.log(
      row.cue || "?",
      row.slide,
      row.covers && row.covers.length ? "COVER " + row.covers.join("+") : "ok",
      row.huge ? "HUGE" : "",
      row.miss ? "MISS " + row.point : ""
    );
    last = snap.n;
  }
  if (!snap.bubble && i > 20) break;
  await page.waitForTimeout(320);
}

const report = [
  "# Walk see",
  "",
  `- cues: ${seen.length}`,
  `- covers: ${seen.filter((r) => r.covers && r.covers.length).length}`,
  `- huge rings: ${seen.filter((r) => r.huge).length}`,
  `- missing targets: ${seen.filter((r) => r.miss).length}`,
  "",
  ...seen.map((r) => {
    const bad = [];
    if (r.covers && r.covers.length) bad.push("COVER " + r.covers.join("+"));
    if (r.huge) bad.push("HUGE");
    if (r.miss) bad.push("MISS " + r.point);
    return `${r.cue || "—"} · ${r.slide} · ${bad.join(" · ") || "ok"}`;
  }),
  "",
].join("\n");
writeFileSync(`${DIR}/REPORT.md`, report);
writeFileSync(`${DIR}/SEE.json`, JSON.stringify(seen, null, 2));
console.log(report);
await browser.close();
if (seen.some((r) => (r.covers && r.covers.length) || r.huge || r.miss)) process.exitCode = 2;
