#!/usr/bin/env node
/**
 * Full walk, no skip. Phone-size Chrome. Video + a frame whenever
 * the cue, ring, or orb changes. Does NOT press Next.
 *
 *   node scripts/tour-symphony.mjs
 *   node scripts/tour-symphony.mjs https://siteplumb.com/app/
 */
import { mkdirSync, writeFileSync, rmSync, existsSync, readFileSync } from "node:fs";
import { chromium } from "playwright";

const URL = process.argv[2] || "https://siteplumb.com/app/?v=symphony";
const DIR = "/workspace/screenshots/tour-symphony";
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
await page.waitForTimeout(600);
await page.evaluate(() => { try { startTeamTour(); } catch (e) {} });

const frames = [];
const beats = [];
const t0 = Date.now();
let lastKey = "";
let lastIdx = -1;
let lastChange = 0;
let nShot = 0;

for (let i = 0; i < 520; i++) {
  const snap = await page.evaluate(() => {
    const s = _tourSteps && typeof _tourIdx === "number" ? _tourSteps[_tourIdx] : null;
    const spot = document.getElementById("tourSpot");
    const bub = document.getElementById("tourBubble");
    const orb = document.getElementById("tourOrb");
    const sr = spot ? spot.getBoundingClientRect() : null;
    const br = bub ? bub.getBoundingClientRect() : null;
    const or = orb && orb.classList.contains("show") ? orb.getBoundingClientRect() : null;
    const tr = (window.__tourTrace || []).slice(-1)[0] || {};
    const all = window.__tourTrace || [];
    return {
      idx: typeof _tourIdx === "number" ? _tourIdx : -1,
      title: (s && s.title) || "",
      cue: tr.name || "",
      ev: tr.ev || "",
      extra: tr.extra || "",
      ring: sr && sr.height > 4 ? { t: Math.round(sr.top), h: Math.round(sr.height), w: Math.round(sr.width) } : null,
      bub: br ? { t: Math.round(br.top), h: Math.round(br.height) } : null,
      orb: or ? { x: Math.round(or.left + or.width / 2), y: Math.round(or.top + or.height / 2) } : null,
      nPlay: all.filter((x) => /^play-/.test(x.ev)).length,
      nFail: all.filter((x) => /fail|silence|error/.test(x.ev)).length,
    };
  });
  snap.ms = Date.now() - t0;
  frames.push(snap);
  if (snap.idx !== lastIdx) {
    lastIdx = snap.idx;
    lastChange = snap.ms;
    beats.push({ kind: "slide", ...snap });
  }
  const key = [snap.idx, snap.cue, snap.ev, snap.ring && snap.ring.t, snap.ring && snap.ring.h, snap.orb && snap.orb.x].join("|");
  if (key !== lastKey) {
    lastKey = key;
    lastChange = snap.ms;
    const fn = String(nShot++).padStart(3, "0") + "-s" + (snap.idx + 1) + "-" + (snap.cue || "x") + "-" + (snap.ev || "e");
    await page.screenshot({ path: DIR + "/" + fn + ".png" });
    beats.push({ kind: "beat", file: fn + ".png", ...snap });
  }
  // Natural end: last slide, no new cue for 8s, or walk gone
  if (snap.idx < 0 && snap.ms > 8000) break;
  if (snap.idx >= 9 && snap.ms - lastChange > 8000) break;
  // Safety: if frozen on one slide with no audio for 22s, note and continue watching a bit more then stop that slide only if 40s
  if (snap.ms > 240000) break;
  await page.waitForTimeout(350);
}

writeFileSync(DIR + "/frames.json", JSON.stringify(frames, null, 2));
writeFileSync(DIR + "/beats.json", JSON.stringify(beats, null, 2));

const slides = [];
frames.forEach((f) => {
  if (!slides.length || slides[slides.length - 1].idx !== f.idx) {
    slides.push({ idx: f.idx, title: f.title, from: f.ms, cues: new Set(), rings: [] });
  }
  const s = slides[slides.length - 1];
  s.to = f.ms;
  if (f.cue) s.cues.add(f.cue);
  if (f.ring) s.rings.push(f.ring);
});
const summary = slides.map((s) => {
  const rs = s.rings;
  const h = rs.map((r) => r.h);
  const t = rs.map((r) => r.t);
  return {
    n: s.idx + 1,
    title: s.title,
    sec: Math.round((s.to - s.from) / 100) / 10,
    cues: [...s.cues],
    ringH: h.length ? Math.min(...h) + "–" + Math.max(...h) : "-",
    ringT: t.length ? Math.min(...t) + "–" + Math.max(...t) : "-",
  };
});
writeFileSync(DIR + "/summary.json", JSON.stringify(summary, null, 2));
console.log("slides", summary.length, "beats", beats.length, "frames", frames.length);
summary.forEach((s) => console.log(s.n, s.title, s.sec + "s", "cues", s.cues.join(","), "h", s.ringH, "t", s.ringT));
const video = page.video();
await ctx.close();
if (video) console.log("video", await video.path());
await browser.close();
