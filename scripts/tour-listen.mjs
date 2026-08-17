#!/usr/bin/env node
/**
 * Walk the LIVE tour without stubbing audio. Dump the in-app trace.
 *
 *   node scripts/tour-listen.mjs
 *   node scripts/tour-listen.mjs https://siteplumb.com/app/
 */
import { mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { chromium } from "playwright";

const URL = process.argv[2] || "https://siteplumb.com/app/?v=listen";
const DIR = "/workspace/screenshots/tour-listen";
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
await page.waitForTimeout(1600);
await page.evaluate(() => {
  try { igBrowser(); sessionStorage.setItem("plumbBrowserOK", "1"); } catch (e) {}
  ["installGate", "startScrim", "setupScrim", "evScrim", "demoIntroScrim"].forEach((id) => {
    try { document.getElementById(id)?.classList.remove("show"); } catch (e) {}
  });
  try {
    sessionStorage.setItem("plumbTourOffered", "1");
    localStorage.setItem("plumbTourMute", "0");
    localStorage.setItem("plumbTourHud", "1");
  } catch (e) {}
});
await page.evaluate(async () => {
  try { enterDemo(); document.getElementById("demoIntroScrim")?.classList.remove("show"); } catch (e) {}
  try { if (typeof loadTourCues === "function") await loadTourCues(); } catch (e) {}
  try { if (typeof tourUnlockAudio === "function") tourUnlockAudio(); } catch (e) {}
  try { showOverview(); renderToday(); renderOvCards(); startTour("team"); } catch (e) {}
});

const shots = [];
let lastN = 0;
for (let i = 0; i < 90; i++) {
  const snap = await page.evaluate(() => {
    const tr = window.__tourTrace || [];
    const s = typeof _tourSteps !== "undefined" && _tourSteps && typeof _tourIdx === "number" ? _tourSteps[_tourIdx] : null;
    return {
      n: tr.length,
      last: tr[tr.length - 1] || null,
      title: s ? s.title : "",
      idx: typeof _tourIdx === "number" ? _tourIdx : -1,
      bubble: !!document.getElementById("tourBubble"),
      mute: typeof tourMuted === "function" ? tourMuted() : null,
    };
  });
  if (snap.n !== lastN && snap.last) {
    const name = String(shots.length).padStart(2, "0") + "-" + (snap.last.ev || "x") + "-" + (snap.last.name || "x");
    await page.screenshot({ path: `${DIR}/${name}.png` });
    shots.push({ ...snap.last, title: snap.title, idx: snap.idx });
    console.log(snap.last.ev, snap.last.name || "", snap.last.extra || "", "·", snap.title);
    lastN = snap.n;
  }
  if (!snap.bubble && i > 8) break;
  await page.waitForTimeout(400);
}

const trace = await page.evaluate(() => window.__tourTrace || []);
writeFileSync(`${DIR}/TRACE.json`, JSON.stringify({ trace, shots }, null, 2));
const silence = trace.filter((x) => /silence|play-fail|error|timeout/.test(x.ev));
const plays = trace.filter((x) => /^play/.test(x.ev));
const ends = trace.filter((x) => /^end/.test(x.ev));
console.log("plays", plays.length, "ends", ends.length, "problems", silence.length);
silence.forEach((x) => console.log("  !", x.ev, x.name, x.extra || ""));
await browser.close();
if (silence.length) process.exitCode = 2;
