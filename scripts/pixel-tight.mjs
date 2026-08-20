#!/usr/bin/env node
/**
 * Tight pixel gate — login-adjacent demo home, house briefing, People, Add a sub, Company.
 * Local ritual. Look at the shots, then --bless. Not a CI auto-bless.
 *
 *   node scripts/pixel-tight.mjs
 *   node scripts/pixel-tight.mjs --bless
 */
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createRequire } from "node:module";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..");
const APP = path.join(ROOT, "app");
const require = createRequire(path.join(APP, "package.json"));
let PNG, pixelmatch;
try {
  PNG = require("pngjs").PNG;
  pixelmatch = require("pixelmatch").default || require("pixelmatch");
} catch (e) {
  PNG = null;
}
const BASE = path.join(APP, "qa-baseline", "tight");
const OUT = path.join(ROOT, "screenshots", "pixel-tight");
const PORT = 8138;
const BLESS = process.argv.includes("--bless");
const SURFACES = [
  { id: "home", run: "try{closeStart();closeSetup();demoIntroExplore&&demoIntroExplore();demoRole('builder');showOverview();renderToday();renderOvCards();}catch(e){}" },
  { id: "house", run: "try{demoRole('builder');nyOpenHouse((state.projects[0]||{}).id);}catch(e){}" },
  { id: "people", run: "try{appMode=function(){return 'real';};openPeopleMode('team');}catch(e){}" },
  { id: "add-sub", run: "try{openAddSub();}catch(e){}" },
  { id: "company", run: "try{openCompany();}catch(e){}" },
];

function serve() {
  return new Promise((res) => {
    const srv = http.createServer((req, resp) => {
      const clean = decodeURIComponent((req.url || "/").split("?")[0]);
      let f = path.join(APP, clean.replace(/^\//, "") || "index.html");
      if (!f.startsWith(APP) || !fs.existsSync(f) || !fs.statSync(f).isFile()) f = path.join(APP, "index.html");
      const ext = path.extname(f);
      const type = ext === ".js" ? "text/javascript" : ext === ".css" ? "text/css" : ext === ".json" ? "application/json" : "text/html";
      resp.writeHead(200, { "Content-Type": type });
      resp.end(fs.readFileSync(f));
    });
    srv.listen(PORT, "127.0.0.1", () => res(srv));
  });
}

async function loadPlaywright() {
  try { return await import("playwright"); } catch (e) {}
  throw new Error("playwright not installed");
}

function diffPng(aPath, bPath, diffPath) {
  if (!PNG || !pixelmatch) return { ok: false, why: "pngjs/pixelmatch not installed in app/" };
  const a = PNG.sync.read(fs.readFileSync(aPath));
  const b = PNG.sync.read(fs.readFileSync(bPath));
  if (a.width !== b.width || a.height !== b.height) return { ok: false, pct: 100, why: "size changed" };
  const diff = new PNG({ width: a.width, height: a.height });
  const n = pixelmatch(a.data, b.data, diff.data, a.width, a.height, { threshold: 0.12 });
  const pct = (n / (a.width * a.height)) * 100;
  if (pct > 0.6) fs.writeFileSync(diffPath, PNG.sync.write(diff));
  return { ok: pct <= 0.6, pct };
}

const { chromium } = await loadPlaywright();
fs.mkdirSync(OUT, { recursive: true });
fs.mkdirSync(BASE, { recursive: true });
const srv = await serve();
const browser = await chromium.launch({ headless: true, args: ["--no-sandbox", "--disable-dev-shm-usage"] });
const page = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
await page.goto("http://127.0.0.1:" + PORT + "/index.html?demo=1&v=pixeltight", { waitUntil: "domcontentloaded", timeout: 45000 });
await page.waitForTimeout(1600);
await page.evaluate(() => {
  try { localStorage.setItem("plumb.startDone", "1"); } catch (e) {}
  try { localStorage.setItem("plumb.setupDone", "1"); } catch (e) {}
  try { localStorage.setItem("plumbWelcomed", "1"); } catch (e) {}
  ["igBrowser", "closeStart", "closeSetup", "demoIntroExplore"].forEach((fn) => {
    try { if (typeof window[fn] === "function") window[fn](); } catch (e) {}
  });
  ["installGate", "startScrim", "setupScrim", "demoIntroScrim", "welcomeScrim"].forEach((id) => {
    try { document.getElementById(id)?.classList.remove("show"); } catch (e) {}
  });
  try { demoRole("builder"); showOverview(); renderToday(); renderOvCards(); } catch (e) {}
});
try { await page.evaluate(() => document.fonts && document.fonts.ready); } catch (e) {}
await page.waitForTimeout(400);

const checks = [];
const note = (name, ok, detail) => {
  checks.push({ name, ok: !!ok, detail: detail || "" });
  console.log((ok ? "PASS" : "FAIL") + "  " + name + (detail ? "  · " + detail : ""));
};

for (const s of SURFACES) {
  await page.evaluate(() => {
    document.querySelectorAll(".pmodal-scrim.show").forEach((el) => el.classList.remove("show"));
    try { closeInfo(); } catch (e) {}
    try { closeSheet(); } catch (e) {}
    try { closeHouse(); } catch (e) {}
    try { showOverview(); } catch (e) {}
  });
  await page.evaluate((code) => { try { (0, eval)(code); } catch (e) {} }, s.run);
  await page.waitForTimeout(350);
  const cur = path.join(OUT, s.id + ".png");
  const base = path.join(BASE, s.id + ".png");
  await page.screenshot({ path: cur, fullPage: false });
  if (BLESS || !fs.existsSync(base)) {
    fs.copyFileSync(cur, base);
    note(s.id, true, BLESS ? "blessed" : "first bless");
    continue;
  }
  try {
    const d = diffPng(base, cur, path.join(OUT, s.id + ".DIFF.png"));
    note(s.id, d.ok, (d.pct != null ? d.pct.toFixed(2) + "% changed" : d.why) + (d.ok ? "" : " — look then --bless"));
  } catch (e) {
    note(s.id, false, e.message);
  }
}

await browser.close();
srv.close();
const fail = checks.filter((c) => !c.ok);
console.log("\nPixel tight  " + (fail.length ? "FAIL " + fail.length : "PASS") + " / " + checks.length + (BLESS ? "  (blessed)" : ""));
process.exit(fail.length ? 1 : 0);
