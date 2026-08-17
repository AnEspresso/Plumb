#!/usr/bin/env node
/** Drive each phrase, screenshot, log cover / robot / missing target. */
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { chromium } from "playwright";

const URL = process.argv[2] || "http://127.0.0.1:8765/app/index.html?v=watch2";
const DIR = "/workspace/screenshots/tour-watch";
rmSync(DIR, { recursive: true, force: true });
mkdirSync(DIR, { recursive: true });

const browser = await chromium.launch({
  headless: true,
  args: ["--no-sandbox", "--disable-dev-shm-usage", "--autoplay-policy=no-user-gesture-required"],
});
const ctx = await browser.newContext({
  viewport: { width: 390, height: 844 },
  isMobile: true,
  hasTouch: true,
});
const page = await ctx.newPage();
const cuesLog = [];
page.on("console", (m) => {
  const t = m.text();
  if (t.startsWith("CUE ")) cuesLog.push(t);
});
await page.goto(URL, { waitUntil: "domcontentloaded", timeout: 30000 });
await page.waitForTimeout(700);
await page.evaluate(() => {
  ["installGate", "startScrim", "setupScrim", "evScrim", "demoIntroScrim"].forEach((id) => {
    try { document.getElementById(id)?.classList.remove("show"); } catch (e) {}
  });
  try { document.getElementById("login")?.classList.add("hide"); } catch (e) {}
  try { sessionStorage.setItem("plumbTourOffered", "1"); localStorage.setItem("plumbTourMute", "1"); } catch (e) {}
});
await page.evaluate(async () => {
  try { enterDemo(); } catch (e) {}
  try { document.getElementById("demoIntroScrim")?.classList.remove("show"); } catch (e) {}
  try { await loadTourCues(); } catch (e) {}
  window.tourPlayFile = function (name) {
    console.log("CUE " + name);
    return new Promise(function (r) { setTimeout(r, 380); });
  };
  window.tourWaitTap = function () { return Promise.resolve(); };
});
await page.waitForTimeout(400);
await page.evaluate(() => {
  try { showOverview(); renderToday(); renderOvCards(); startTour("team"); } catch (e) {}
});
await page.waitForTimeout(500);

const rows = [];
let lastKey = "";
let stuck = 0;
for (let i = 0; i < 50; i++) {
  const snap = await page.evaluate(() => {
    const s = _tourSteps && typeof _tourIdx === "number" ? _tourSteps[_tourIdx] : null;
    const bub = document.getElementById("tourBubble");
    const spot = document.getElementById("tourSpot");
    let overlap = false, bubR = null, spotR = null;
    if (bub) bubR = bub.getBoundingClientRect();
    if (spot) spotR = spot.getBoundingClientRect();
    if (bubR && spotR && spotR.height > 4) {
      overlap = bubR.left < spotR.right && bubR.right > spotR.left && bubR.top < spotR.bottom && bubR.bottom > spotR.top;
    }
    const ov = document.getElementById("overview");
    return {
      idx: typeof _tourIdx === "number" ? _tourIdx : -1,
      title: s ? s.title : "",
      robot: !!(window.speechSynthesis && speechSynthesis.speaking),
      overlap,
      bubble: !!(bub && getComputedStyle(bub).opacity !== "0"),
      bubTop: bubR ? Math.round(bubR.top) : -1,
      spotTop: spotR ? Math.round(spotR.top) : -1,
      spotH: spotR ? Math.round(spotR.height) : 0,
      sheet: !!document.getElementById("sheet")?.classList.contains("show"),
      company: !!document.getElementById("companyScrim")?.classList.contains("show"),
      house: !!document.getElementById("houseScrim")?.classList.contains("show"),
      overview: !!(ov && ov.classList.contains("show")),
    };
  });
  const key = snap.idx + ":" + snap.title;
  const name = String(i).padStart(2, "0") + "-s" + (snap.idx + 1) + "-" + (snap.title || "x").replace(/[^a-z0-9]+/gi, "-").slice(0, 16);
  await page.screenshot({ path: `${DIR}/${name}.png` });
  rows.push({ i, ...snap });
  console.log(i, "s" + (snap.idx + 1), snap.title, snap.overlap ? "COVER" : "ok", "bub", snap.bubTop, "spot", snap.spotTop, "h" + snap.spotH, snap.sheet ? "sheet" : "", snap.house ? "house" : "", snap.company ? "co" : "", snap.overview ? "ov" : "site");
  if (!snap.bubble && i > 3) break;
  if (key === lastKey) stuck++;
  else stuck = 0;
  lastKey = key;
  if (stuck > 8) {
    await page.evaluate(() => { try { tourNext(); } catch (e) {} });
    stuck = 0;
  }
  await page.waitForTimeout(420);
}
writeFileSync(`${DIR}/LOG.json`, JSON.stringify({ rows, cuesLog }, null, 2));
console.log("COVER", rows.filter((r) => r.overlap).length, "/", rows.length, "ROBOT", rows.filter((r) => r.robot).length);
await browser.close();
