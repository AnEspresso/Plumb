#!/usr/bin/env node
/**
 * Four-viewport contact sheet.
 * Same 7 screens on iPhone, Android, Mac, PC. Fails on overflow or a blank page.
 * Writes shots + a single HTML sheet you can glance at.
 *
 *   node scripts/contact-sheet.mjs
 *   node scripts/contact-sheet.mjs --out /tmp/sheet
 */
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..");
const APP = path.join(ROOT, "app");
const OUT = process.argv.includes("--out")
  ? path.resolve(process.argv[process.argv.indexOf("--out") + 1])
  : path.join(ROOT, "screenshots", "contact");
const PORT = 8135;

const VIEWS = [
  { id: "iphone", w: 390, h: 844, mobile: true },
  { id: "android", w: 412, h: 915, mobile: true },
  { id: "mac", w: 1440, h: 900, mobile: false },
  { id: "pc", w: 1920, h: 1080, mobile: false },
];

const STEPS = [
  { id: "home", run: `try{closeStart();closeSetup();demoIntroExplore&&demoIntroExplore();demoRole('hillan');showOverview();renderToday();renderOvCards();}catch(e){}` },
  { id: "inbox", run: `try{openNyInbox();}catch(e){}` },
  { id: "house", run: `try{closePkLog();nyOpenHouse((state.projects[0]||{}).id);}catch(e){}` },
  { id: "calendar", run: `try{closeHouse();houseGoCal?houseGoCal():openCal();}catch(e){}` },
  { id: "field", run: `try{closeCal();closeDay();closeHouse();openLogPick();}catch(e){}` },
  { id: "settings", run: `try{closeLogPick();openSettings();}catch(e){}` },
  { id: "start", run: `try{closeSettings();openStart();}catch(e){}` },
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
  const candidates = [
    path.join(HERE, "../../node_modules/playwright/index.mjs"),
    path.join(HERE, "../../../node_modules/playwright/index.mjs"),
  ];
  for (const p of candidates) {
    try { if (fs.existsSync(p)) return await import(pathToFileURL(p).href); } catch (e) {}
  }
  throw new Error("playwright not installed");
}

const { chromium } = await loadPlaywright();
fs.mkdirSync(OUT, { recursive: true });
const srv = await serve();
const browser = await chromium.launch({
  headless: true,
  args: ["--no-sandbox", "--disable-dev-shm-usage"],
});

const fails = [];
const rows = [];

for (const v of VIEWS) {
  const page = await browser.newPage({
    viewport: { width: v.w, height: v.h },
    isMobile: v.mobile,
    hasTouch: v.mobile,
  });
  page.on("pageerror", (e) => fails.push(v.id + " pageerror " + String(e).slice(0, 120)));
  await page.goto("http://127.0.0.1:" + PORT + "/index.html?demo=1", { waitUntil: "domcontentloaded", timeout: 45000 });
  await page.waitForTimeout(1600);
  await page.evaluate(() => {
    try { localStorage.setItem("plumb.startDone", "1"); } catch (e) {}
    try { localStorage.setItem("plumb.setupDone", "1"); } catch (e) {}
    ["igBrowser", "closeStart", "closeSetup", "demoIntroExplore"].forEach((fn) => {
      try { if (typeof window[fn] === "function") window[fn](); } catch (e) {}
    });
    ["installGate", "startScrim", "setupScrim", "demoIntroScrim"].forEach((id) => {
      try { document.getElementById(id)?.classList.remove("show"); } catch (e) {}
    });
  });
  await page.waitForTimeout(400);

  for (const step of STEPS) {
    await page.evaluate((code) => { try { (0, eval)(code); } catch (e) {} }, step.run);
    await page.waitForTimeout(280);
    const info = await page.evaluate(() => {
      const root = document.documentElement;
      return {
        overflow: root.scrollWidth > root.clientWidth + 2,
        text: (document.body.innerText || "").replace(/\s+/g, " ").trim().slice(0, 80),
      };
    });
    const file = `${step.id}--${v.id}.png`;
    await page.screenshot({ path: path.join(OUT, file) });
    if (info.overflow) fails.push(`${v.id}/${step.id} overflow`);
    if (!info.text) fails.push(`${v.id}/${step.id} blank`);
    rows.push({ view: v.id, step: step.id, file, overflow: info.overflow, blank: !info.text });
    console.log((info.overflow || !info.text ? "FAIL" : "ok  ") + "  " + v.id + " · " + step.id);
  }
  await page.close();
}

await browser.close();
srv.close();

const html = `<!doctype html><meta charset="utf-8"><title>SitePlumb contact sheet</title>
<style>
  body{margin:0;background:#1c1916;color:#f7f4ef;font:13px/1.4 -apple-system,sans-serif}
  h1{font-size:16px;font-weight:600;padding:18px 18px 8px}
  .row{display:grid;grid-template-columns:repeat(4,1fr);gap:8px;padding:0 12px 18px}
  figure{margin:0;background:#111;border-radius:10px;overflow:hidden}
  img{width:100%;display:block;background:#222}
  figcaption{padding:6px 8px;color:#c9c2b8}
  .fail{outline:2px solid #c45c4a}
</style>
<h1>Four surfaces · ${new Date().toISOString().slice(0, 16)}</h1>
${STEPS.map((s) => `<h1>${s.id}</h1><div class="row">${VIEWS.map((v) => {
  const r = rows.find((x) => x.step === s.id && x.view === v.id);
  const bad = r && (r.overflow || r.blank);
  return `<figure class="${bad ? "fail" : ""}"><img src="${s.id}--${v.id}.png" alt="${s.id} ${v.id}"><figcaption>${v.id}${bad ? " · FAIL" : ""}</figcaption></figure>`;
}).join("")}</div>`).join("")}
`;
fs.writeFileSync(path.join(OUT, "index.html"), html);
fs.writeFileSync(path.join(OUT, "REPORT.json"), JSON.stringify({ when: new Date().toISOString(), fails, rows }, null, 2));
console.log("sheet  " + path.join(OUT, "index.html"));
console.log(fails.length ? "FAIL  " + fails.join(" | ") : "PASS  " + rows.length + " shots, no overflow");
process.exit(fails.length ? 1 : 0);
