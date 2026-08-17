#!/usr/bin/env node
/**
 * Full walk, no skip. Phone-size Chrome. Video + a frame whenever
 * the cue, ring, or orb changes. Does NOT press Next.
 *
 *   node scripts/tour-symphony.mjs
 *   node scripts/tour-symphony.mjs https://siteplumb.com/app/
 */
import { mkdirSync, writeFileSync, rmSync, existsSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { chromium } from "playwright";

const URL = process.argv[2] || "https://siteplumb.com/app/?v=symphony";
const DIR = "/workspace/screenshots/tour-symphony";
rmSync(DIR, { recursive: true, force: true });
mkdirSync(DIR, { recursive: true });
const TOKEN = existsSync("/workspace/.secrets/appcheck_debug_token")
  ? readFileSync("/workspace/.secrets/appcheck_debug_token", "utf8").trim()
  : "";

const says = {};
try {
  const raw = JSON.parse(readFileSync("/workspace/siteplumb/app/tour-audio/cues.json", "utf8"));
  (raw.slides || []).forEach((s) => (s.cues || []).forEach((c) => { if (c.id) says[c.id] = c.say || ""; }));
} catch (e) {}

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
await page.evaluate((says) => {
  window.__TOUR_SAYS = says;
  window.__tourHeard = [];
  let el = document.getElementById("tourScoreHud");
  if (!el) {
    el = document.createElement("div");
    el.id = "tourScoreHud";
    el.setAttribute(
      "style",
      "position:fixed;left:8px;right:8px;bottom:8px;z-index:4000;font:11px/1.35 ui-sans-serif,system-ui;background:#1c1916ee;color:#f7f4ef;padding:8px 10px;border-radius:10px;pointer-events:none;max-height:28%;overflow:hidden"
    );
    document.body.appendChild(el);
  }
  window.__tourScorePaint = function () {
    try {
      const tr = (window.__tourTrace || []).slice(-1)[0] || {};
      const all = window.__tourTrace || [];
      const live = all.filter((x) => /^play-/.test(x.ev) && !/ended|fail|silence|timeout/.test(x.ev));
      const lastPlay = [...all].reverse().find((x) => /^play-/.test(x.ev));
      const cue = (lastPlay && lastPlay.name) || tr.name || "";
      const say = (window.__TOUR_SAYS && window.__TOUR_SAYS[cue]) || "";
      const ids = ["houseScrim", "companyScrim", "sheet", "scrim", "overview", "tourBubble", "tourSpot"];
      const stack = [];
      ids.forEach((id) => {
        const n = document.getElementById(id);
        if (!n) return;
        const st = getComputedStyle(n);
        const on = n.classList.contains("show") || (id.startsWith("tour") && st.display !== "none");
        if (!on && id !== "overview") return;
        if (id === "overview" && !n.classList.contains("show")) return;
        stack.push({ id, z: parseInt(st.zIndex, 10) || 0 });
      });
      stack.sort((a, b) => b.z - a.z);
      const top = stack[0] ? stack[0].id : "page";
      const a = window._tourEl;
      let clip = "";
      try {
        const src = (a && a.currentSrc) || "";
        const m = src.match(/(s\d+[a-z])\.mp3/i);
        if (m) clip = m[1];
      } catch (e) {}
      const elOn = !!(a && !a.paused && a.currentTime > 0.02);
      const acOn = !!window._tourSrc;
      const voices = (elOn ? 1 : 0) + (acOn ? 1 : 0);
      window.__tourHeard.push({ ms: Date.now(), clip, elOn, acOn, voices });
      window.__tourVoices = voices;
      window.__tourStack = stack;
      window.__tourSay = say;
      el.textContent = (say ? "“" + say + "”" : cue) + " · on top: " + top + (voices > 1 ? " · DOUBLE VOICE" : "");
    } catch (e) {}
  };
  setInterval(window.__tourScorePaint, 200);
  window.__tourScorePaint();
}, says);

await page.waitForTimeout(2500);
const gate = await page.evaluate(() => {
  const all = window.__tourTrace || [];
  const plays = all.filter((x) => /^play-/.test(x.ev));
  const fails = all.filter((x) => /fail|silence|error/.test(x.ev));
  const a = window._tourEl;
  const spot = document.getElementById("tourSpot");
  const sr = spot ? spot.getBoundingClientRect() : null;
  const orb = document.getElementById("tourOrb");
  const or = orb && orb.classList.contains("show") ? orb.getBoundingClientRect() : null;
  return {
    plays: plays.map((p) => (p.ev || "") + " " + (p.name || "")),
    fails: fails.map((p) => p.ev),
    time: a ? a.currentTime : 0,
    paused: a ? !!a.paused : true,
    src: a && a.currentSrc ? a.currentSrc.split("/").pop() : "",
    ringH: sr ? Math.round(sr.height) : 0,
    orb: or ? { x: Math.round(or.left + or.width / 2), y: Math.round(or.top + or.height / 2) } : null,
    bubble: !!document.getElementById("tourBubble"),
    idx: typeof _tourIdx === "number" ? _tourIdx : -1,
  };
});
const heard =
  gate.plays.some((p) => /^play-(el|ac)/.test(p)) ||
  (!gate.paused && gate.time > 0.12);
const frozen = !heard;
writeFileSync(
  DIR + "/freeze.json",
  JSON.stringify({ frozen, heard, gate, at: "t+2.5s" }, null, 2)
);
await page.screenshot({ path: DIR + (frozen ? "/FREEZE.png" : "/start-ok.png") });
if (frozen) {
  console.log("FREEZE at start — no Ara. ring", gate.ringH, "orb", gate.orb, "plays", gate.plays, "fails", gate.fails);
} else {
  console.log("start ok", gate.src || gate.plays[0], "t", Math.round(gate.time * 10) / 10, "ring", gate.ringH);
}

const frames = [];
const beats = [];
const t0 = Date.now();
let lastKey = "";
let lastIdx = -1;
let lastChange = 0;
let nShot = 0;

for (let i = 0; i < 700; i++) {
  const snap = await page.evaluate(() => {
    try { if (window.__tourScorePaint) window.__tourScorePaint(); } catch (e) {}
    const s = _tourSteps && typeof _tourIdx === "number" ? _tourSteps[_tourIdx] : null;
    const spot = document.getElementById("tourSpot");
    const bub = document.getElementById("tourBubble");
    const orb = document.getElementById("tourOrb");
    const sr = spot ? spot.getBoundingClientRect() : null;
    const br = bub ? bub.getBoundingClientRect() : null;
    const or = orb && orb.classList.contains("show") ? orb.getBoundingClientRect() : null;
    const tr = (window.__tourTrace || []).slice(-1)[0] || {};
    const all = window.__tourTrace || [];
    let cover = false;
    if (sr && br && sr.height > 8) {
      cover = br.left < sr.right && br.right > sr.left && br.top < sr.bottom && br.bottom > sr.top;
    }
    return {
      idx: typeof _tourIdx === "number" ? _tourIdx : -1,
      title: (s && s.title) || "",
      cue: tr.name || "",
      ev: tr.ev || "",
      extra: tr.extra || "",
      say: window.__tourSay || "",
      ring: sr && sr.height > 4 ? { t: Math.round(sr.top), h: Math.round(sr.height), w: Math.round(sr.width) } : null,
      bub: br ? { t: Math.round(br.top), h: Math.round(br.height) } : null,
      orb: or ? { x: Math.round(or.left + or.width / 2), y: Math.round(or.top + or.height / 2) } : null,
      cover,
      stack: window.__tourStack || [],
      top: (window.__tourStack && window.__tourStack[0] && window.__tourStack[0].id) || "",
      voices: window.__tourVoices || 0,
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
  if (snap.ms > 360000) break;
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
try {
  const tape = await page.evaluate(() => window.__tourHeard || []);
  writeFileSync(DIR + "/tape.json", JSON.stringify(tape));
  console.log("tape", tape.length);
} catch (e) {
  console.log("tape fail", e && e.message);
}
console.log("slides", summary.length, "beats", beats.length, "frames", frames.length);
summary.forEach((s) => console.log(s.n, s.title, s.sec + "s", "cues", s.cues.join(","), "h", s.ringH, "t", s.ringT));
const video = page.video();
await ctx.close();
if (video) console.log("video", await video.path());
await browser.close();
spawnSync("python3", ["/workspace/siteplumb/scripts/tour-orbpath.py", DIR], { stdio: "inherit" });
spawnSync("python3", ["/workspace/siteplumb/scripts/tour-hear.py", DIR], { stdio: "inherit" });
const scored = spawnSync("node", ["/workspace/siteplumb/scripts/tour-score.mjs", DIR], { encoding: "utf8" });
if (scored.stdout) process.stdout.write(scored.stdout);
if (scored.stderr) process.stderr.write(scored.stderr);
if (scored.status) process.exit(scored.status);
