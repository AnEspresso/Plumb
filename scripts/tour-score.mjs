#!/usr/bin/env node
/**
 * Scorebook from a symphony folder.
 *   node scripts/tour-score.mjs
 *   node scripts/tour-score.mjs /workspace/screenshots/tour-symphony
 */
import { readFileSync, writeFileSync, existsSync, readdirSync } from "node:fs";
import { join } from "node:path";

const DIR = process.argv[2] || "/workspace/screenshots/tour-symphony";
const cuesPath = "/workspace/siteplumb/app/tour-audio/cues.json";

const says = {};
try {
  const raw = JSON.parse(readFileSync(cuesPath, "utf8"));
  (raw.slides || []).forEach((s) => (s.cues || []).forEach((c) => { if (c.id) says[c.id] = c.say || ""; }));
} catch (e) {}

const beats = existsSync(DIR + "/beats.json") ? JSON.parse(readFileSync(DIR + "/beats.json", "utf8")) : [];
const frames = existsSync(DIR + "/frames.json") ? JSON.parse(readFileSync(DIR + "/frames.json", "utf8")) : [];
const src = beats.length ? beats : frames;

function cover(r, b) {
  if (!r || !b) return false;
  return b.t < r.t + r.h && b.t + b.h > r.t && true;
}
function gap(r, b) {
  if (!r || !b) return null;
  if (b.t + b.h <= r.t) return r.t - (b.t + b.h);
  if (r.t + r.h <= b.t) return b.t - (r.t + r.h);
  return 0;
}

const rows = [];
src.forEach((x) => {
  if (x.kind === "slide") return;
  if (!x.file && !x.cue) return;
  const say = x.say || says[x.cue] || "";
  const cov = !!x.cover || cover(x.ring, x.bub);
  const g = x.gap != null ? x.gap : gap(x.ring, x.bub);
  const top = (x.stack && x.stack[0] && x.stack[0].id) || x.top || "";
  rows.push({
    ms: x.ms || 0,
    slide: (x.idx == null ? -1 : x.idx) + 1,
    title: x.title || "",
    cue: x.cue || "",
    ev: x.ev || "",
    say,
    ring: x.ring || null,
    bub: x.bub || null,
    orb: x.orb || null,
    cover: cov,
    gap: g,
    top,
    stack: x.stack || [],
    file: x.file || "",
    nPlay: x.nPlay,
    nFail: x.nFail,
    voices: x.voices || 1,
  });
});

const flags = [];
rows.forEach((r) => {
  if (r.cover) flags.push({ ms: r.ms, slide: r.slide, cue: r.cue, kind: "COVER", detail: "card on gold box" });
  if (r.voices > 1) flags.push({ ms: r.ms, slide: r.slide, cue: r.cue, kind: "DOUBLE", detail: r.voices + " voices" });
  if (r.top === "houseScrim" && /site|log|Full/.test(r.title + r.cue + r.say)) {
    flags.push({ ms: r.ms, slide: r.slide, cue: r.cue, kind: "UNDER", detail: "house sheet on top of site" });
  }
  if (r.cue === "s1a" && r.voices > 1) flags.push({ ms: r.ms, slide: r.slide, cue: r.cue, kind: "DOUBLE", detail: "Glad you're here twice" });
});

let heard = { heard: [], doubles: [] };
try {
  if (existsSync(DIR + "/heard.json")) heard = JSON.parse(readFileSync(DIR + "/heard.json", "utf8"));
} catch (e) {}
(heard.doubles || []).forEach((d) => {
  flags.push({ ms: Math.round((d.times && d.times[0] || 0) * 1000), slide: 0, cue: d.clip, kind: "DOUBLE", detail: (d.say || d.clip) + " at " + (d.times || []).join("s, ") + "s" });
});
if ((heard.heard || []).filter((h) => h.clip === "s1a").length > 1) {
  flags.push({ ms: 0, slide: 1, cue: "s1a", kind: "DOUBLE", detail: "Glad you're here heard more than once in the video" });
}
try {
  if (existsSync(DIR + "/freeze.json")) {
    const fr = JSON.parse(readFileSync(DIR + "/freeze.json", "utf8"));
    if (fr.frozen) {
      flags.push({ ms: 2500, slide: 1, cue: "s1a", kind: "FREEZE", detail: "no Ara 2.5s after start · plays " + ((fr.gate && fr.gate.plays) || []).join(",") });
    }
  }
} catch (e) {}
const bySlide = {};
rows.forEach((r) => {
  const k = r.slide;
  if (!bySlide[k]) bySlide[k] = { slide: k, title: r.title, cues: [], covers: 0, n: 0, tops: {} };
  const s = bySlide[k];
  s.n++;
  if (r.cover) s.covers++;
  if (r.cue && !s.cues.includes(r.cue)) s.cues.push(r.cue);
  if (r.top) s.tops[r.top] = (s.tops[r.top] || 0) + 1;
});

const seen = new Set();
const uniq = [];
flags.forEach((f) => {
  const k = f.kind + "|" + f.slide + "|" + f.cue + "|" + f.detail;
  if (seen.has(k)) return;
  seen.add(k);
  uniq.push(f);
});

const score = { dir: DIR, rows, flags: uniq, slides: Object.values(bySlide) };
writeFileSync(DIR + "/score.json", JSON.stringify(score, null, 2));

const thumbs = (file) => (file ? `<img src="${file}" alt="" width="130">` : "");
const html = `<!doctype html><meta charset="utf-8"><title>Symphony score</title>
<style>
body{margin:0;background:#1c1916;color:#e7dcc6;font:13px/1.4 ui-sans-serif,system-ui}
h1{font:600 18px/1.2 ui-sans-serif;margin:16px 18px 8px}
.flag{margin:6px 18px;padding:8px 10px;background:#5c2a1a;border-radius:8px}
.ok{background:#1f3d2a}
table{border-collapse:collapse;width:100%}
td,th{border-top:1px solid #3d372f;padding:8px 10px;vertical-align:top}
th{text-align:left;color:#c4b8a6;font-weight:600}
.say{color:#f7f4ef}
.bad{color:#f0b4a0}
img{border-radius:8px;display:block}
</style>
<h1>Symphony score · ${rows.length} beats · ${uniq.length} flags</h1>
${uniq.slice(0, 24).map((f) => `<div class="flag"><b>${f.kind}</b> s${f.slide} ${f.cue} · ${f.detail}</div>`).join("")}
<table>
<tr><th></th><th>when</th><th>slide / cue</th><th>Ara says</th><th>box</th><th>card</th><th>on top</th></tr>
${rows.filter((r) => r.file || r.ev === "play-ac" || r.ev === "play-el").map((r) => `
<tr>
<td>${thumbs(r.file)}</td>
<td>${Math.round((r.ms || 0) / 100) / 10}s</td>
<td>s${r.slide} ${r.title}<br><b>${r.cue}</b> ${r.ev}</td>
<td class="say">${(r.say || "").replace(/</g, "<")}</td>
<td>${r.ring ? r.ring.t + "/" + r.ring.h : "—"}</td>
<td class="${r.cover ? "bad" : ""}">${r.cover ? "ON BOX" : (r.gap != null ? r.gap + "px air" : "—")}</td>
<td>${r.top || "—"}</td>
</tr>`).join("")}
</table>`;
writeFileSync(DIR + "/scorebook.html", html);

const md = [
  `# Symphony score`,
  ``,
  `${rows.length} beats · ${uniq.length} flags`,
  ``,
  uniq.length ? uniq.map((f) => `- **${f.kind}** s${f.slide} ${f.cue} — ${f.detail}`).join("\n") : "- no flags",
  ``,
  `## Heard in the video`,
  ``,
  (heard.heard || []).length
    ? (heard.heard || []).map((h) => `- ${h.t}s · ${h.clip} · ${(h.say || "").slice(0, 80)}`).join("\n")
    : "- (no hear pass)",
  ``,
  `| slide | cues | cover | on top |`,
  `|---|---|---|---|`,
  ...Object.values(bySlide).map((s) => `| ${s.slide} ${s.title} | ${s.cues.join(" ")} | ${s.covers}/${s.n} | ${Object.keys(s.tops).join(", ") || "—"} |`),
].join("\n");
writeFileSync(DIR + "/SCORE.md", md);
console.log("score", DIR + "/SCORE.md", "flags", uniq.length, "beats", rows.length);
uniq.slice(0, 12).forEach((f) => console.log(" ", f.kind, "s" + f.slide, f.cue, f.detail));
