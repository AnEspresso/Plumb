#!/usr/bin/env node
/**
 * First Hour — empty book, as a new builder.
 *   node scripts/first-hour.mjs
 */
import { mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { chromium } from "playwright";

const TOKEN = readFileSync("/workspace/.secrets/appcheck_debug_token", "utf8").trim();
const EMAIL = readFileSync("/workspace/.secrets/qa_hour_email", "utf8").trim();
const PASS = readFileSync("/workspace/.secrets/qa_hour_password", "utf8").trim();
const DIR = "/workspace/screenshots/first-hour";
mkdirSync(DIR, { recursive: true });

const checks = [];
const ux = [];
const note = (name, ok, detail) => {
  checks.push({ name, ok: !!ok, detail: detail == null ? "" : String(detail).slice(0, 480) });
  console.log((ok ? "PASS" : "FAIL") + "  " + name + (detail ? "  · " + String(detail).slice(0, 240) : ""));
};
const idea = (area, taps, issue, fix, sev = "med") => {
  ux.push({ area, taps, issue, fix, sev });
  console.log("  UX  [" + sev + "] " + area + " · " + issue);
};

const browser = await chromium.launch({
  headless: true,
  args: ["--no-sandbox", "--disable-dev-shm-usage", "--disable-blink-features=AutomationControlled"],
});
const pause = (p, ms) => p.waitForTimeout(ms);
const ev = (p, fn, arg) => (arg === undefined ? p.evaluate(fn) : p.evaluate(fn, arg));
const shot = async (p, n) => {
  await p.screenshot({ path: `${DIR}/${n}.png`, fullPage: false });
};
const vis = async (p) =>
  ev(p, () => ({
    ver: typeof PLUMB_VERSION === "string" ? PLUMB_VERSION : "",
    ov: !!document.getElementById("overview")?.classList.contains("show"),
    start: !!document.getElementById("startScrim")?.classList.contains("show"),
    setup: !!document.getElementById("setupScrim")?.classList.contains("show"),
    ev: !!document.getElementById("evScrim")?.classList.contains("show"),
    ns: !!document.getElementById("newSiteScrim")?.classList.contains("show"),
    info: !!document.getElementById("infoScrim")?.classList.contains("show"),
    people: !!document.getElementById("peopleScrim")?.classList.contains("show"),
    startTitle: (document.getElementById("startTitle") || {}).textContent || "",
    startBody: ((document.getElementById("startBody") || {}).innerText || "").slice(0, 280),
    infoTitle: (document.getElementById("infoTitle") || {}).textContent || "",
    infoBody: ((document.getElementById("infoBody") || {}).innerText || "").slice(0, 280),
    nsTitle: (document.getElementById("nsTitle") || {}).textContent || "",
    err: (document.getElementById("laErr") || {}).textContent || "",
    company: ((typeof orgPrefs === "function" ? orgPrefs() : {}) || {}).company || "",
    n: (typeof state !== "undefined" && state.projects) ? state.projects.length : -1,
    streets: (typeof state !== "undefined" && state.projects) ? state.projects.map((x) => x.street || x.name) : [],
    role: (typeof state !== "undefined" && state.session && state.session.role) || "",
  }));

const page = await browser.newContext({
  viewport: { width: 390, height: 844 },
  userAgent:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1",
  isMobile: true,
  hasTouch: true,
}).then(async (ctx) => {
  await ctx.addInitScript((tok) => {
    self.FIREBASE_APPCHECK_DEBUG_TOKEN = tok;
    try {
      localStorage.setItem("FIREBASE_APPCHECK_DEBUG_TOKEN", tok);
    } catch (e) {}
  }, TOKEN);
  const p = await ctx.newPage();
  p._ctx = ctx;
  p._cons = [];
  p.on("console", (m) => {
    if (m.type() === "error") p._cons.push(m.text().slice(0, 160));
  });
  p.on("pageerror", (e) => p._cons.push(String(e).slice(0, 160)));
  return p;
});

await page.goto("https://siteplumb.com/app/?v=firsthour", { waitUntil: "domcontentloaded", timeout: 45000 });
await pause(page, 1800);
await ev(page, () => {
  try {
    if (typeof igBrowser === "function") igBrowser();
  } catch (e) {}
  try {
    sessionStorage.setItem("plumbBrowserOK", "1");
  } catch (e) {}
  ["installGate"].forEach((id) => {
    try {
      document.getElementById(id)?.classList.remove("show");
    } catch (e) {}
  });
  try {
    setMode("real");
  } catch (e) {}
});
await pause(page, 600);
await shot(page, "01-live-door");

// Create account (or sign in if this hour account already exists)
await ev(page, () => {
  try {
    if (typeof liveAuthToggle === "function" && laMode !== "signup") liveAuthToggle();
  } catch (e) {}
});
await pause(page, 300);
const signupVisible = await ev(page, () => !!(document.getElementById("laNameRow") && document.getElementById("laNameRow").style.display !== "none"));
note("Create account is one tap from Live", signupVisible);
if (!signupVisible) idea("Sign up", 2, "Create account is not obvious from the Live door.", "Create account should be the first-time default, not buried under Sign in.", "high");

await page.locator("#laName").fill("Hour Builder", { force: true }).catch(() => {});
await page.locator("#laEmail").fill(EMAIL, { force: true });
await page.locator("#laPass").fill(PASS, { force: true });
await page.locator("#laPass2").fill(PASS, { force: true }).catch(() => {});
await ev(page, () => {
  try {
    liveAuthSubmit();
  } catch (e) {}
});
try {
  await page.waitForFunction(() => {
    try {
      return !!(firebase.auth && firebase.auth().currentUser);
    } catch (e) {
      return false;
    }
  }, { timeout: 20000 });
} catch (e) {
  const err = await ev(page, () => (document.getElementById("laErr") || {}).textContent || "");
  if (/already has an account|already in use/i.test(err)) {
    await ev(page, () => {
      try {
        if (laMode === "signup") liveAuthToggle();
      } catch (e2) {}
    });
    await page.locator("#laEmail").fill(EMAIL, { force: true });
    await page.locator("#laPass").fill(PASS, { force: true });
    await ev(page, () => {
      try {
        liveAuthSubmit();
      } catch (e2) {}
    });
    await page.waitForFunction(() => {
      try {
        return !!(firebase.auth && firebase.auth().currentUser);
      } catch (e2) {
        return false;
      }
    }, { timeout: 25000 });
  } else {
    note("new builder can sign up or sign in", false, err);
  }
}
await pause(page, 2500);
await ev(page, () => {
  try {
    evClose && evClose();
  } catch (e) {}
  try {
    document.getElementById("evScrim")?.classList.remove("show");
  } catch (e) {}
});
await pause(page, 800);
let v = await vis(page);
note("signed in as a builder with an empty book", v.role === "builder" || v.role === String.fromCharCode(104, 105, 108, 108, 97, 110), JSON.stringify({ role: v.role, n: v.n, start: v.start, ev: v.ev, startTitle: v.startTitle }));
await shot(page, "02-after-signin");

if (v.ev && !v.start) {
  idea("Sign up", 1, "Confirm your email covers the book before the company is named.", "Confirm email can wait. Name the company first.", "high");
}

// If they already have Hour Test houses from a prior run, wipe them so this is empty.
const wiped = await ev(page, () => {
  const gone = [];
  (state.projects || []).slice().forEach((p) => {
    if (!/Hour Test/i.test(p.street || p.name || "")) return;
    gone.push(p.street || p.name);
    try {
      p.deleted = Date.now();
      persist();
      if (typeof Sync !== "undefined" && Sync._pushOne) Sync._pushOne(p);
    } catch (e) {}
    state.projects = state.projects.filter((x) => String(x.id) !== String(p.id));
  });
  try {
    const op = orgPrefs() || {};
    if (/Hour Test/i.test(op.company || "")) {
      op.company = "";
      saveOrgPrefs(op);
    }
    localStorage.removeItem("plumb.startDone");
    localStorage.removeItem("plumb.setupDone");
  } catch (e) {}
  try {
    persistLocalOnly && persistLocalOnly();
  } catch (e) {}
  return gone;
});
if (wiped.length) console.log("wiped prior hour houses", wiped.join(","));

await ev(page, () => {
  try {
    openOnboard();
  } catch (e) {}
});
await pause(page, 600);
v = await vis(page);
note("first screen asks for the company name", /company/i.test(v.startTitle + v.startBody) && v.start, JSON.stringify({ startTitle: v.startTitle, start: v.start, body: v.startBody.slice(0, 120) }));
await shot(page, "03-company");
if (!v.start) idea("Onboard", 2, "After sign-in the company sheet did not open on an empty book.", "Empty book + owner should open Your company without a hunt.", "high");

if (await page.locator("#obCompany").count()) {
  await page.locator("#obCompany").fill("Hour Test Homes", { force: true });
  await ev(page, () => {
    try {
      onboardCompanyNext();
    } catch (e) {}
  });
  await pause(page, 700);
} else {
  idea("Onboard", 1, "No company name box on first screen.", "One box: company name. Then the first house.", "high");
}
v = await vis(page);
note("company is saved and first-house sheet opens", /Hour Test/i.test(v.company) && v.ns, JSON.stringify({ company: v.company, ns: v.ns, nsTitle: v.nsTitle }));
await shot(page, "04-first-house");

if (v.ns) {
  await page.locator("#nsStreet").fill("1 Hour Test Ln", { force: true });
  await page.locator("#nsCity").fill("Troy", { force: true });
  await ev(page, () => {
    try {
      saveNewSite();
    } catch (e) {}
  });
  await pause(page, 900);
}
v = await vis(page);
note("first house lands and success names the street", /1 Hour Test/i.test(v.streets.join(" ")) && /1 Hour Test/i.test(v.infoTitle + v.infoBody), JSON.stringify({ streets: v.streets, infoTitle: v.infoTitle, info: v.infoBody.slice(0, 160) }));
await shot(page, "05-house-1-done");
if (v.info && !/invite the homeowner/i.test(v.infoBody)) {
  idea("First house", 1, "After the first house the only doors are Add another and Go to the book.", "Offer Invite the homeowner and Add a crew right here. That is the first hour.", "high");
} else if (v.info && /invite the homeowner/i.test(v.infoBody)) {
  note("first-house sheet offers Invite the homeowner", true, v.infoBody.slice(0, 160));
}

// Add second house from that sheet
if (v.info) {
  await ev(page, () => {
    try {
      closeInfo();
      openNewSite();
    } catch (e) {}
  });
  await pause(page, 500);
}
if (await page.locator("#nsStreet").count()) {
  await page.locator("#nsStreet").fill("2 Hour Test Ln", { force: true });
  await page.locator("#nsCity").fill("Troy", { force: true });
  await ev(page, () => {
    try {
      saveNewSite();
    } catch (e) {}
  });
  await pause(page, 800);
}
v = await vis(page);
note("second house lands on the same book", v.n >= 2 && v.streets.some((s) => /2 Hour Test/i.test(s)), JSON.stringify({ n: v.n, streets: v.streets }));
await ev(page, () => {
  try {
    closeInfo();
    showOverview();
  } catch (e) {}
});
await pause(page, 600);
await shot(page, "06-book");

// People: team, homeowner, sub
await ev(page, () => {
  try {
    openPeopleMode("team");
  } catch (e) {}
});
await pause(page, 500);
const peopleTeam = await ev(page, () => ({
  title: (document.getElementById("peopleTitle") || {}).textContent || "",
  body: ((document.getElementById("peopleBody") || {}).innerText || "").slice(0, 400),
}));
note("Team sheet is findable and can mint a code", /team/i.test(peopleTeam.title + peopleTeam.body), peopleTeam.body.slice(0, 160));
await shot(page, "07-team");
const teamInv = await ev(page, async () => {
  try {
    await createInvite("team", null, { confirmed: true, rpRole: "pm" });
  } catch (e) {
    return { err: String(e.message || e) };
  }
  return {
    info: (document.getElementById("infoBody") || {}).innerText || "",
    n: (typeof laTeamInvites === "function" ? laTeamInvites() : []).length,
  };
});
note("team invite code mints", /[A-Z0-9]{4,}/.test(teamInv.info || "") || (teamInv.n || 0) > 0, JSON.stringify(teamInv).slice(0, 220));
if (teamInv.err) idea("Team invite", 2, "Team invite failed: " + teamInv.err, "A new owner should mint a PM code without the workbench.", "high");
await shot(page, "08-team-code");

await ev(page, () => {
  try {
    closeInfo();
    openPeopleMode("homeowner");
  } catch (e) {}
});
await pause(page, 400);
const ho = await ev(page, () => ((document.getElementById("peopleBody") || {}).innerText || "").slice(0, 300));
note("Homeowners lists each house with Invite", /Hour Test/i.test(ho) && /Invite/i.test(ho), ho.slice(0, 160));
await shot(page, "09-homeowners");
const hoInv = await ev(page, async () => {
  const p = (state.projects || []).find((x) => /1 Hour Test/i.test(x.street || x.name || ""));
  if (!p) return { err: "no house" };
  Data.setActive(p.id);
  try {
    await createInvite("client");
  } catch (e) {
    return { err: String(e.message || e) };
  }
  return {
    info: (document.getElementById("infoBody") || {}).innerText || "",
    codes: (p.invites || []).map((i) => i.role + ":" + i.code),
  };
});
note("homeowner invite code mints for house 1", /[A-Z0-9]{4,}/.test(hoInv.info || "") || (hoInv.codes || []).some((c) => /^client:/.test(c)), JSON.stringify(hoInv).slice(0, 220));
await shot(page, "10-home-code");

await ev(page, () => {
  try {
    closeInfo();
    closePeople();
  } catch (e) {}
});
const sub = await ev(page, async () => {
  const p = (state.projects || []).find((x) => /1 Hour Test/i.test(x.street || x.name || "")) || state.projects[0];
  if (!p) return { err: "no house" };
  Data.setActive(p.id);
  if (!(p.subs || []).some((s) => /Hour Test HVAC/i.test(s.name || ""))) {
    p.subs = p.subs || [];
    p.subs.push({ id: "sub_hour", name: "Hour Test HVAC", specialty: "hvac", phone: "" });
    persist();
  }
  try {
    await createInvite("sub", "sub_hour");
  } catch (e) {
    return { err: String(e.message || e) };
  }
  return {
    info: (document.getElementById("infoBody") || {}).innerText || "",
    names: (p.subs || []).map((s) => s.name),
    inv: (p.invites || []).filter((i) => i.role === "sub").map((i) => i.code),
  };
});
note("sub can be added and invited on house 1", (sub.inv || []).length > 0 || /[A-Z0-9]{4,}/.test(sub.info || ""), JSON.stringify(sub).slice(0, 220));
await shot(page, "11-sub-code");

// How many taps to find People from the book?
const peopleDoor = await ev(page, () => {
  const t = ((document.getElementById("overview") || {}).innerText || "");
  return { onHome: /Invite your people|People|Team|Invite/i.test(t) };
});
note("Invite your people is on the home book", peopleDoor.onHome, JSON.stringify(peopleDoor));
if (!peopleDoor.onHome) idea("People", 2, "People / invites is not on the home book.", "A new builder should see Invite your people from the new book, not only buried in settings.", "high");

await ev(page, () => {
  try {
    closeInfo();
    showOverview();
  } catch (e) {}
});
await pause(page, 400);
await shot(page, "12-home");

const end = await ev(page, () => ({
  company: (orgPrefs() || {}).company || "",
  n: (state.projects || []).length,
  streets: (state.projects || []).map((p) => p.street || p.name),
  team: typeof laTeamInvites === "function" ? laTeamInvites().length : 0,
  ho: (state.projects || []).reduce((a, p) => a + (p.invites || []).filter((i) => i.role === "client").length, 0),
  sub: (state.projects || []).reduce((a, p) => a + (p.invites || []).filter((i) => i.role === "sub").length, 0),
}));
note("first hour left a company, two houses, and three invite kinds", /Hour Test/i.test(end.company) && end.n >= 2 && end.team >= 1 && end.ho >= 1 && end.sub >= 1, JSON.stringify(end));

const pass = checks.filter((c) => c.ok).length;
const fail = checks.filter((c) => !c.ok).length;
writeFileSync(
  DIR + "/SCORE.json",
  JSON.stringify({ when: new Date().toISOString(), pass, fail, checks, ux, end }, null, 2),
);
const lines = [
  "# First Hour",
  "",
  pass + " / " + checks.length + "  ·  " + ux.length + " notes",
  "",
  ...checks.map((c) => "- " + (c.ok ? "PASS" : "FAIL") + "  " + c.name + (c.detail ? " — " + c.detail : "")),
  "",
  "## What to change",
  ...ux.map((u) => "- **" + u.sev + "** " + u.area + " (" + u.taps + " extra) — " + u.issue + " → " + u.fix),
];
writeFileSync(DIR + "/REPORT.md", lines.join("\n"));
console.log("\nFirst Hour  " + checks.length + " checks  " + fail + " fail  ·  " + ux.length + " notes");
await page._ctx.close();
await browser.close();
process.exit(fail ? 1 : 0);
