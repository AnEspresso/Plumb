#!/usr/bin/env node
/**
 * Real-time film of the live walk: video + 400ms frames + ring/orb/audio log.
 *   node scripts/tour-film.mjs
 *   node scripts/tour-film.mjs https://siteplumb.com/app/
 */
import { mkdirSync, writeFileSync, rmSync, existsSync, readFileSync } from "node:fs";
import { chromium } from "playwright";

const URL = process.argv[2] || "https://siteplumb.com/app/?v=film";
const DIR = "/workspace/screenshots/tour-film";
rmSync(DIR, { recursive: true, force: true });
mkdirSync(DIR, { recursive: true });
const TOKEN = existsSync("/workspace/.secrets/appcheck_debug_token")
  ? readFileSync("/workspace/.secrets/appcheck_debug_token", "utf8").trim()
  : "";

const browser = await chromium.launch({
  headless: true,
  args: ["--no-sandbox", "--disable-dev-shm-usage", "--autoplay-policy=no-user-gesture-required"],
});
const ctx = await browser.newContext({
  viewport: { width: 390, height: 844 },
  isMobile: true,
  hasTouch: true,
  recordVideo: { dir: DIR, size: { width: 390, height: 844 } },
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
await page.evaluate(() => {
  try { enterDemo({ skipPersist: true }); document.getElementById("demoIntroScrim")?.classList.remove("show"); } catch (e) {}
});
await page.waitForTimeout(500);
await page.evaluate(() => { try { startTeamTour(); } catch (e) {} });

const frames = [];
const t0 = Date.now();
for (let i = 0; i < 90; i++) {
  const snap = await page.evaluate(() => {
    const s = _tourSteps && typeof _tourIdx === "number" ? _tourSteps[_tourIdx] : null;
    const spot = document.getElementById("tourSpot");
    const bub = document.getElementById("tourBubble");
    const orb = document.getElementById("tourOrb");
    const sr = spot ? spot.getBoundingClientRect() : null;
    const br = bub ? bub.getBoundingClientRect() : null;
    const or = orb ? orb.getBoundingClientRect() : null;
    const tr = (window.__tourTrace || []).slice(-1)[0] || {};
    let cover = false;
    if (sr && br && sr.height > 8) {
      cover = br.left < sr.right && br.right > sr.left && br.top < sr.bottom && br.bottom > sr.top;
    }
    return {
      idx: typeof _tourIdx === "number" ? _tourIdx : -1,
      title: (s && s.title) || "",
      cue: tr.name || "",
      ev: tr.ev || "",
      ring: sr ? { t: Math.round(sr.top), h: Math.round(sr.height), w: Math.round(sr.width) } : null,
      bub: br ? { t: Math.round(br.top), h: Math.round(br.height) } : null,
      orb: or ? { x: Math.round(or.left), y: Math.round(or.top) } : null,
      cover,
      hud: (document.getElementById("tourHud") || {}).textContent || "",
    };
  });
  snap.ms = Date.now() - t0;
  frames.push(snap);
  const name = String(i).padStart(3, "0") + "-" + (snap.cue || snap.title || "x").replace(/[^\w]+/g, "").slice(0, 16);
  await page.screenshot({ path: DIR + "/" + name + ".png" });
  if (snap.idx >= 9 && snap.ev === "ended" && i > 20) break;
  await page.waitForTimeout(400);
}

writeFileSync(DIR + "/film.json", JSON.stringify(frames, null, 2));
const jumps = [];
for (let i = 1; i < frames.length; i++) {
  const a = frames[i - 1].ring, b = frames[i].ring;
  if (!a || !b) continue;
  const dh = Math.abs(a.h - b.h), dt = Math.abs(a.t - b.t);
  if (dh > 80 || dt > 80) jumps.push({ i, ms: frames[i].ms, from: a, to: b, title: frames[i].title, cue: frames[i].cue });
}
writeFileSync(DIR + "/jumps.json", JSON.stringify({ jumps, n: frames.length }, null, 2));
console.log("frames", frames.length, "ring-jumps", jumps.length);
jumps.slice(0, 12).forEach((j) => console.log(" jump", j.ms, j.title, j.cue, j.from, "->", j.to));
const video = page.video();
await ctx.close();
if (video) {
  const vpath = await video.path();
  console.log("video", vpath);
}
await browser.close();
