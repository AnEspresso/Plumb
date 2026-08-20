#!/usr/bin/env node
/**
 * Sheet contract — one black action, pills on one line, no overflow.
 * Blocking ship ritual. Same rules as Workbench → Run census.
 *
 *   node scripts/sheet-contract.mjs
 */
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..");
const APP = path.join(ROOT, "app");
const OUT = path.join(ROOT, "screenshots", "sheet-contract");
const PORT = 8137;

const SURFACES = [
  { id: "home", skipBlack: true, run: "try{closeStart();closeSetup();demoIntroExplore&&demoIntroExplore();demoRole('builder');showOverview();renderToday();renderOvWeek();renderOvCards();}catch(e){}" },
  { id: "company", run: "try{openCompany();}catch(e){}" },
  { id: "people-team", run: "try{appMode=function(){return 'real';};openPeopleMode('team');}catch(e){}" },
  { id: "people-invite", run: "try{appMode=function(){return 'real';};openPeopleMode('invite');}catch(e){}" },
  { id: "people-subs", run: "try{appMode=function(){return 'real';};openPeopleMode('subs');}catch(e){}" },
  { id: "add-sub", run: "try{openAddSub();}catch(e){}" },
  { id: "settings", run: "try{openSettings();}catch(e){}" },
  { id: "notifications", run: "try{openNotifyCenter();}catch(e){}" },
  { id: "invoices", run: "try{openInvoices();}catch(e){}" },
  { id: "new-house", run: "try{openNewSite();}catch(e){}" },
  { id: "setup", run: "try{openSetup();}catch(e){}" },
  { id: "field-note", run: "try{window._tourQuiet=true;openFieldNote();}catch(e){}" },
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
const browser = await chromium.launch({ headless: true, args: ["--no-sandbox", "--disable-dev-shm-usage"] });
const page = await browser.newPage({
  viewport: { width: 390, height: 844 },
  isMobile: true,
  hasTouch: true,
  userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1",
});
await page.goto("http://127.0.0.1:" + PORT + "/index.html?demo=1&v=contract", { waitUntil: "domcontentloaded", timeout: 45000 });
await page.waitForTimeout(1400);
await page.evaluate(() => {
  try { localStorage.setItem("plumb.startDone", "1"); } catch (e) {}
  try { localStorage.setItem("plumb.setupDone", "1"); } catch (e) {}
  try { localStorage.setItem("plumbWelcomed", "1"); } catch (e) {}
  ["igBrowser", "closeStart", "closeSetup", "demoIntroExplore"].forEach((fn) => {
    try { if (typeof window[fn] === "function") window[fn](); } catch (e) {}
  });
  ["installGate", "startScrim", "setupScrim", "demoIntroScrim", "welcomeScrim", "evScrim"].forEach((id) => {
    try { document.getElementById(id)?.classList.remove("show"); } catch (e) {}
  });
  try { if (typeof demoRole === "function") demoRole("builder"); } catch (e) {}
  try { showOverview(); renderToday(); renderOvCards(); } catch (e) {}
});
await page.waitForTimeout(400);

const hasFn = await page.evaluate(() => typeof sheetContract === "function");
if (!hasFn) {
  console.error("FAIL  sheetContract missing in app");
  await browser.close();
  srv.close();
  process.exit(1);
}

const checks = [];
const note = (name, ok, detail) => {
  checks.push({ name, ok: !!ok, detail: detail == null ? "" : String(detail).slice(0, 280) });
  console.log((ok ? "PASS" : "FAIL") + "  " + name + (detail ? "  · " + String(detail).slice(0, 180) : ""));
};

async function closeAll() {
  await page.evaluate(() => {
    document.querySelectorAll(".pmodal-scrim.show, .ss-scrim.show").forEach((el) => el.classList.remove("show"));
    try { if (typeof closeCal === "function") closeCal(); } catch (e) {}
    try { if (typeof closeHouse === "function") closeHouse(); } catch (e) {}
    try { if (typeof closeInfo === "function") closeInfo(); } catch (e) {}
    try { if (typeof closeSheet === "function") closeSheet(); } catch (e) {}
    try { showOverview(); } catch (e) {}
  });
  await page.waitForTimeout(60);
}

for (const s of SURFACES) {
  await closeAll();
  await page.evaluate((code) => { try { (0, eval)(code); } catch (e) {} }, s.run);
  await page.waitForTimeout(280);
  const c = await page.evaluate(() => sheetContract());
  await page.screenshot({ path: path.join(OUT, s.id + ".png"), fullPage: false });
  const bits = [];
  if (!s.skipBlack && c.blacks && c.blacks.length > 1) bits.push("blacks: " + c.blacks.join(" | "));
  if (c.wrap && c.wrap.length) bits.push("wrap: " + c.wrap.join(" | "));
  if (c.overflow) bits.push("overflow");
  note(s.id, bits.length === 0, bits.join("; ") || ((c.title || s.id) + " · blacks " + (c.blacks || []).join("|")));
}

const fail = checks.filter((c) => !c.ok);
fs.writeFileSync(path.join(OUT, "REPORT.md"), [
  "# Sheet contract",
  "",
  fail.length ? fail.length + " failed of " + checks.length : "All " + checks.length + " surfaces passed.",
  "",
  ...checks.map((c) => `- ${c.ok ? "PASS" : "**FAIL**"} ${c.name}${c.detail ? " — " + c.detail : ""}`),
  "",
].join("\n"));

await browser.close();
srv.close();
console.log("\nSheet contract  " + (fail.length ? "FAIL " + fail.length : "PASS") + " / " + checks.length);
process.exit(fail.length ? 1 : 0);
