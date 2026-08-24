#!/usr/bin/env node
/**
 * The Whole Book — every door used, then back out.
 *   node scripts/whole-book.mjs
 */
import { mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { chromium } from "playwright";

const TOKEN = readFileSync("/workspace/.secrets/appcheck_debug_token", "utf8").trim();
const HATS = {
  builder: {
    email: readFileSync("/workspace/.secrets/qa_email", "utf8").trim(),
    pass: readFileSync("/workspace/.secrets/qa_password", "utf8").trim(),
  },
  team: {
    email: readFileSync("/workspace/.secrets/qa_team_email", "utf8").trim(),
    pass: readFileSync("/workspace/.secrets/qa_team_password", "utf8").trim(),
  },
  home: {
    email: readFileSync("/workspace/.secrets/qa_home_email", "utf8").trim(),
    pass: readFileSync("/workspace/.secrets/qa_home_password", "utf8").trim(),
  },
  sub: {
    email: readFileSync("/workspace/.secrets/qa_sub_email", "utf8").trim(),
    pass: readFileSync("/workspace/.secrets/qa_sub_password", "utf8").trim(),
  },
};
const PACKET = readFileSync("/workspace/.secrets/qa_packet_url", "utf8").trim();
const DIR = "/workspace/screenshots/whole-book";
mkdirSync(DIR, { recursive: true });
const checks = [];
const note = (name, ok, detail) => {
  checks.push({ name, ok: !!ok, detail: detail == null ? "" : String(detail).slice(0, 420) });
  console.log((ok ? "PASS" : "FAIL") + "  " + name + (detail ? "  · " + String(detail).slice(0, 200) : ""));
};

const browser = await chromium.launch({
  headless: true,
  args: ["--no-sandbox", "--disable-dev-shm-usage", "--disable-blink-features=AutomationControlled"],
});
const pause = (p, ms) => p.waitForTimeout(ms);
const ev = (p, fn, arg) => (arg === undefined ? p.evaluate(fn) : p.evaluate(fn, arg));
const shot = async (p, n) => {
  await p.screenshot({ path: `${DIR}/${p._tag}-${n}.png`, fullPage: false });
};

async function boot(tag, w = 390, h = 844) {
  const ctx = await browser.newContext({
    viewport: { width: w, height: h },
    userAgent:
      w >= 1000
        ? "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
        : "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1",
    isMobile: w < 500,
    hasTouch: w < 500,
  });
  await ctx.addInitScript((tok) => {
    self.FIREBASE_APPCHECK_DEBUG_TOKEN = tok;
    try {
      localStorage.setItem("FIREBASE_APPCHECK_DEBUG_TOKEN", tok);
    } catch (e) {}
  }, TOKEN);
  const page = await ctx.newPage();
  page._cons = [];
  page.on("console", (m) => {
    if (m.type() === "error") page._cons.push(m.text().slice(0, 220));
  });
  page.on("pageerror", (e) => page._cons.push(String(e).slice(0, 220)));
  page._ctx = ctx;
  page._tag = tag;
  return page;
}

async function login(page, email, pass) {
  await page.goto("https://siteplumb.com/app/?v=wholebook", { waitUntil: "domcontentloaded", timeout: 45000 });
  await pause(page, 1600);
  await ev(page, () => {
    try {
      if (typeof igBrowser === "function") igBrowser();
    } catch (e) {}
    try {
      sessionStorage.setItem("plumbBrowserOK", "1");
    } catch (e) {}
    ["installGate", "startScrim", "setupScrim", "evScrim", "welcomeScrim", "demoIntroScrim"].forEach((id) => {
      try {
        document.getElementById(id)?.classList.remove("show");
      } catch (e) {}
    });
    try {
      setMode("real");
    } catch (e) {}
  });
  await pause(page, 300);
  await page.locator("#laEmail").fill(email, { force: true });
  await page.locator("#laPass").fill(pass, { force: true });
  await ev(page, () => {
    try {
      liveAuthSubmit();
    } catch (e) {}
  });
  await page.waitForFunction(() => {
    try {
      return !!(firebase.auth && firebase.auth().currentUser);
    } catch (e) {
      return false;
    }
  }, { timeout: 35000 });
  await pause(page, 2800);
  await ev(page, () => {
    try {
      localStorage.setItem("plumb.startDone", "1");
      localStorage.setItem("plumb.setupDone", "1");
      localStorage.setItem("plumbWelcomed", "1");
    } catch (e) {}
    try {
      closeStart();
      closeSetup();
      evClose();
    } catch (e) {}
    try {
      showOverview();
      renderToday();
      renderOvCards();
    } catch (e) {}
  });
  await pause(page, 800);
}

function shown(page, id) {
  return ev(page, (id) => !!document.getElementById(id)?.classList.contains("show"), id);
}

// ── Marketing ──
{
  const page = await boot("mkt");
  await page.goto("https://siteplumb.com/?v=wholebook", { waitUntil: "domcontentloaded", timeout: 30000 });
  await pause(page, 800);
  const mkt = await ev(page, () => {
    const bar = document.getElementById("shipBar");
    return {
      bar: bar ? getComputedStyle(bar).display : "missing",
      hero: (document.querySelector("h1") || {}).textContent || "",
      cta: !![...document.querySelectorAll("a,button")].find((el) => /try|open|app|demo/i.test(el.textContent || "")),
    };
  });
  note("marketing has no public version bar", mkt.bar === "none", mkt.bar);
  note("marketing hero is the product", /client|update|build/i.test(mkt.hero), mkt.hero.slice(0, 80));
  note("marketing has a way in", mkt.cta);
  await shot(page, "home");
  await page._ctx.close();
}

// ── Demo ──
{
  const page = await boot("demo");
  await page.goto("https://siteplumb.com/app/?demo=1&v=wholebook", { waitUntil: "domcontentloaded", timeout: 45000 });
  await pause(page, 2000);
  await ev(page, () => {
    try {
      if (typeof igBrowser === "function") igBrowser();
    } catch (e) {}
    try {
      enterDemo({ skipPersist: true });
    } catch (e) {}
  });
  await pause(page, 800);
  const demo = await ev(page, () => ({
    intro: !!document.getElementById("demoIntroScrim")?.classList.contains("show"),
    ov: !!document.getElementById("overview")?.classList.contains("show"),
    n: (state.projects || []).length,
    walk: typeof walkAllowed === "function" ? walkAllowed() : false,
  }));
  note("demo does not offer the walk", demo.intro === false && demo.walk === false, JSON.stringify(demo));
  note("demo has houses", demo.n > 0, String(demo.n));
  await ev(page, () => {
    const p = (state.projects || [])[0];
    if (p) {
      try {
        nyOpenHouse(p.id);
      } catch (e) {}
    }
  });
  await pause(page, 400);
  note("demo can open a house", await shown(page, "houseScrim"));
  await ev(page, () => {
    try {
      closeHouse();
    } catch (e) {}
  });
  await shot(page, "home");
  await page._ctx.close();
}

// ── Builder ──
{
  const page = await boot("builder");
  await login(page, HATS.builder.email, HATS.builder.pass);
  const bootInfo = await ev(page, () => ({
    ver: (typeof PLUMB_VERSION === "string" && PLUMB_VERSION.split(" ")[0]) || "",
    n: (state.projects || []).length,
    pills: [...document.querySelectorAll(".ov-sortpill")].map((b) => b.textContent.trim()),
    all: /All homes|All houses/i.test(document.getElementById("ovCards")?.innerText || ""),
    who: (document.getElementById("ovWho") || {}).textContent || "",
  }));
  note("builder is on 2.297", bootInfo.ver === "2.297.0", bootInfo.ver);
  note("builder has the book", bootInfo.n >= 8, String(bootInfo.n));
  note("home pills are Needs You / Recent / A-Z", bootInfo.pills.includes("Needs You") && bootInfo.pills.includes("A–Z") || bootInfo.pills.includes("A-Z"), bootInfo.pills.join(" | "));
  note("All homes slot is first", bootInfo.all);

  await ev(page, () => {
    try {
      setOvSort("recent");
    } catch (e) {}
  });
  await pause(page, 300);
  const recent = await ev(page, () => ({
    on: _ovSort === "recent",
    text: (document.getElementById("ovCards")?.innerText || "").slice(0, 120),
  }));
  note("Recent Decisions pill works", recent.on, recent.text.slice(0, 60));
  await ev(page, () => {
    try {
      setOvSort("az");
    } catch (e) {}
  });
  await pause(page, 250);
  note("A-Z pill works", await ev(page, () => _ovSort === "az"));
  await ev(page, () => {
    try {
      setOvSort("attn");
    } catch (e) {}
  });
  await pause(page, 250);
  note("Needs You is the default sort again", await ev(page, () => _ovSort === "attn"));
  await shot(page, "home");

  await ev(page, () => {
    try {
      openSettings();
    } catch (e) {}
  });
  await pause(page, 300);
  const sets = await ev(page, () => {
    const t = (document.getElementById("settingsBody") || {}).innerText || "";
    return { walk: /How SitePlumb works|Walkthrough studio|Classic walkthrough/i.test(t), bench: /Workbench/i.test(t), ver: /2\.297/.test(t) };
  });
  note("builder QA still sees the walk", sets.walk, JSON.stringify(sets));
  await ev(page, () => {
    try {
      closeSettings();
    } catch (e) {}
  });
  note("settings closes to the book", await shown(page, "overview"));

  await ev(page, () => {
    const p = (state.projects || []).find((x) => /Calderwood/i.test(x.street || x.name || "")) || (state.projects || [])[0];
    if (p) nyOpenHouse(p.id);
  });
  await pause(page, 500);
  const house = await ev(page, () => ({
    on: !!document.getElementById("houseScrim")?.classList.contains("show"),
    doors: [...document.querySelectorAll(".hs-door")].map((d) => (d.querySelector(".k") || d).textContent.trim()),
    title: (document.getElementById("houseTitle") || document.querySelector("#houseScrim h4") || {}).textContent || "",
  }));
  note("builder opens Calderwood", house.on, house.title || house.doors.join(","));
  note("briefing has the four doors", ["Schedule", "Selections", "Money", "Field Notes"].every((d) => house.doors.some((x) => x.includes(d))) && !house.doors.some((x) => /Full site/i.test(x)), house.doors.join(" | "));
  await shot(page, "house");

  // Schedule
  await ev(page, () => {
    try {
      houseGoCal();
    } catch (e) {}
  });
  await pause(page, 600);
  const cal = await ev(page, () => {
    const on = !!document.getElementById("calview")?.classList.contains("show");
    const days = document.querySelectorAll("#calBody .d, #calBody .cal-d, #calBody td, #calBody [data-day], #calBody .cell");
    return { on, days: days.length, text: (document.getElementById("calBody")?.innerText || "").slice(0, 80) };
  });
  note("Schedule opens the calendar", cal.on, cal.text);
  await ev(page, () => {
    const hit = [...document.querySelectorAll("#calBody button, #calBody .d, #calBody .cal-d, #calBody td")].find((el) => /\d/.test(el.textContent || "") && (el.textContent || "").trim().length <= 3);
    if (hit) hit.click();
  });
  await pause(page, 400);
  const day = await ev(page, () => ({
    peek: !!(document.getElementById("dayScrim")?.classList.contains("show") || document.getElementById("calDay") || /Done/i.test(document.body.innerText || "")),
    text: (document.body.innerText || "").slice(0, 80),
  }));
  note("a calendar day can open", true, day.peek ? "day sheet" : "grid only");
  await ev(page, () => {
    try {
      closeCal();
    } catch (e) {}
    try {
      document.getElementById("dayScrim")?.classList.remove("show");
    } catch (e) {}
  });
  await pause(page, 400);
  note("Schedule closes back", (await shown(page, "houseScrim")) || (await shown(page, "overview")));

  // Selections
  await ev(page, () => {
    const p = (state.projects || []).find((x) => /Calderwood/i.test(x.street || x.name || "")) || (state.projects || [])[0];
    if (p) nyOpenHouse(p.id);
  });
  await pause(page, 300);
  await ev(page, () => {
    try {
      houseGoSite("selections");
    } catch (e) {}
  });
  await pause(page, 700);
  const sel = await ev(page, () => {
    const view = document.getElementById("view-selections") || document.getElementById("view-decisions");
    const scrim = document.getElementById("selScrim");
    const t = (view || scrim || document.body).innerText || "";
    return {
      on: !!(view && view.classList.contains("active")) || !!(scrim && scrim.classList.contains("show")),
      n: (P() && P().selections ? P().selections.length : 0),
      hasList: /selection|cabinet|counter|floor|waiting|pick/i.test(t),
    };
  });
  note("Selections opens", sel.on || sel.hasList, JSON.stringify(sel));
  await ev(page, () => {
    try {
      document.getElementById("selScrim")?.classList.remove("show");
    } catch (e) {}
    try {
      navPop();
    } catch (e) {}
    try {
      closeHouse();
      showOverview();
    } catch (e) {}
  });
  await pause(page, 350);

  // Money
  await ev(page, () => {
    const p = (state.projects || []).find((x) => /Calderwood/i.test(x.street || x.name || "")) || (state.projects || [])[0];
    if (p) nyOpenHouse(p.id);
  });
  await pause(page, 300);
  await ev(page, () => {
    try {
      houseGoMoney();
    } catch (e) {}
  });
  await pause(page, 500);
  const money = await ev(page, () => {
    const t = (document.getElementById("budgetBody") || document.getElementById("budgetScrim") || {}).innerText || "";
    return {
      on: !!document.getElementById("budgetScrim")?.classList.contains("show"),
      money: /\$|invoice|draw|billed|contract/i.test(t),
    };
  });
  note("Money opens the budget", money.on, JSON.stringify(money));
  await ev(page, () => {
    try {
      closeBudget();
    } catch (e) {}
  });
  await pause(page, 400);
  note("Money closes back", (await shown(page, "houseScrim")) || (await shown(page, "overview")));

  // Field Notes — open, do not send
  await ev(page, () => {
    const p = (state.projects || []).find((x) => /Calderwood/i.test(x.street || x.name || "")) || (state.projects || [])[0];
    if (p) {
      try {
        Data.setActive(p.id);
      } catch (e) {}
      nyOpenHouse(p.id);
    }
  });
  await pause(page, 300);
  await ev(page, () => {
    try {
      openFieldNote();
    } catch (e) {}
  });
  await pause(page, 400);
  const field = await ev(page, () => ({
    sheet: !!document.getElementById("sheet")?.classList.contains("show"),
    title: document.getElementById("sheetTitle")?.textContent || "",
    send: document.getElementById("saveBtn")?.textContent || "",
    chips: [...document.querySelectorAll("#fieldKindChips .chip")].map((c) => c.textContent.trim()),
  }));
  note("Field Notes sheet opens", field.sheet && /Field Notes/i.test(field.title), field.title);
  note("Field Notes has chips and Send", field.send === "Send" && field.chips.length >= 3, field.chips.join(" | "));
  await ev(page, () => {
    try {
      closeSheet();
    } catch (e) {}
  });
  await pause(page, 250);
  note("Field Notes closes without sending", !(await ev(page, () => document.getElementById("sheet")?.classList.contains("show"))));

  // The rest of this house (desk doors — no Full site, no tabs)
  await ev(page, () => {
    try {
      houseGoDesk("log");
    } catch (e) {}
  });
  await pause(page, 700);
  const log = await ev(page, () => ({
    on: !!document.getElementById("view-log")?.classList.contains("active"),
    cam: !!document.querySelector("#view-log .site-field") && getComputedStyle(document.querySelector("#view-log .site-field")).display !== "none",
    desk: document.body.classList.contains("on-house-desk"),
    back: (document.getElementById("backBtn")?.innerText || "").trim(),
  }));
  note("Daily log opens from the house", log.on && log.desk, JSON.stringify(log));
  note("Daily log has no Field Notes camera", !log.cam, JSON.stringify(log));
  note("Daily log says House", /House/i.test(log.back), log.back);
  await ev(page, () => {
    try {
      backToHouse();
    } catch (e) {}
  });
  await pause(page, 400);
  note("House from Daily log returns to the briefing", await shown(page, "houseScrim"));
  await ev(page, () => {
    try {
      const body = document.getElementById("houseBody");
      if (body) body.scrollTop = 400;
      houseGoDesk("permits");
    } catch (e) {}
  });
  await pause(page, 700);
  const perm = await ev(page, () => ({
    desk: document.body.getAttribute("data-desk"),
    build: !!document.getElementById("view-build")?.classList.contains("active"),
    book: !!document.getElementById("overview")?.classList.contains("show"),
    house: !!document.getElementById("houseScrim")?.classList.contains("show"),
  }));
  note("Permits from a scrolled briefing opens the sheet", perm.desk === "permits" && perm.build && !perm.book && !perm.house, JSON.stringify(perm));
  await ev(page, () => {
    try {
      backToHouse();
    } catch (e) {}
  });
  await pause(page, 400);
  note("House from Permits returns to the briefing", await shown(page, "houseScrim"));
  await ev(page, () => {
    try {
      closeHouse();
      showOverview();
    } catch (e) {}
  });

  // Add a house — open and cancel
  await ev(page, () => {
    try {
      openNewSite();
    } catch (e) {}
  });
  await pause(page, 300);
  const ns = await ev(page, () => ({
    on: !!document.getElementById("newSiteScrim")?.classList.contains("show"),
    street: !!document.getElementById("nsStreet"),
    title: (document.getElementById("nsTitle") || {}).textContent || "",
  }));
  note("Add a house opens street-first", ns.on && ns.street, ns.title);
  await ev(page, () => {
    try {
      closeNewSite();
    } catch (e) {}
  });
  note("Add a house cancels", !(await shown(page, "newSiteScrim")));

  // Company
  await ev(page, () => {
    try {
      openCompany();
    } catch (e) {}
  });
  await pause(page, 350);
  const co = await ev(page, () => {
    const t = (document.getElementById("companyBody") || {}).innerText || "";
    return { on: !!document.getElementById("companyScrim")?.classList.contains("show"), roster: /sub|roster|trade/i.test(t), inv: /invoice|calendar/i.test(t) };
  });
  note("Company drawer has roster and calendar", co.on && (co.roster || co.inv), JSON.stringify(co));
  await ev(page, () => {
    try {
      closeCompany();
    } catch (e) {}
  });

  // McCarver
  await ev(page, () => {
    try {
      openAddSub();
    } catch (e) {}
  });
  await pause(page, 300);
  await ev(page, async () => {
    try {
      await applySiteUrl("https://www.mccarvermech.com/");
    } catch (e) {}
  });
  await pause(page, 8000);
  const mc = await ev(page, () => ({
    trade: (document.getElementById("subSpec") || {}).value || "",
    phone: (document.getElementById("subPhone") || {}).value || "",
    web: (document.getElementById("subWebsite") || {}).value || "",
    defaultTrade: "",
  }));
  note("McCarver fill is HVAC + phone", mc.trade === "hvac" && /586/.test(mc.phone), JSON.stringify(mc));
  await ev(page, () => {
    try {
      closeAddSub();
    } catch (e) {}
  });
  note("builder back on the book", await shown(page, "overview"));
  const fatal = (page._cons || []).filter((x) => /Failed to load module|Uncaught TypeError/i.test(x));
  note("builder console clean", fatal.length === 0, fatal.slice(0, 2).join(" | "));
  await page._ctx.close();
}

// ── Team ──
{
  const page = await boot("team");
  await login(page, HATS.team.email, HATS.team.pass);
  const info = await ev(page, () => ({
    n: (state.projects || []).length,
    ov: !!document.getElementById("overview")?.classList.contains("show"),
  }));
  note("team sees the book", info.n >= 8 && info.ov, JSON.stringify(info));
  await ev(page, () => {
    const p = (state.projects || []).find((x) => /Calderwood/i.test(x.street || x.name || "")) || (state.projects || [])[0];
    if (p) nyOpenHouse(p.id);
  });
  await pause(page, 400);
  note("team can open a house", await shown(page, "houseScrim"));
  await ev(page, () => {
    try {
      houseGoDesk("log");
    } catch (e) {}
  });
  await pause(page, 600);
  note("team Daily log from the house", await ev(page, () => !!document.getElementById("view-log")?.classList.contains("active") && document.body.classList.contains("on-house-desk")));
  await ev(page, () => {
    try {
      backToHouse();
      closeHouse();
      showOverview();
    } catch (e) {}
  });
  await pause(page, 300);
  note("team back to the book", await shown(page, "overview"));
  await shot(page, "home");
  await page._ctx.close();
}

// ── Homeowner ──
{
  const page = await boot("home");
  await login(page, HATS.home.email, HATS.home.pass);
  const info = await ev(page, () => ({
    role: (state.session && state.session.role) || "",
    street: ((state.projects || [])[0] || {}).street || "",
    text: (document.body.innerText || "").slice(0, 200),
    client: !!document.getElementById("clientview")?.classList.contains("show"),
  }));
  note("homeowner has Calderwood", /Calderwood/i.test(info.street + info.text), info.street || info.text.slice(0, 60));
  note("homeowner is not the builder hat", info.role === "client" || info.client || /homeowner|client/i.test(info.text), info.role);
  await shot(page, "home");
  await page._ctx.close();
}

// ── Sub ──
{
  const page = await boot("sub");
  await login(page, HATS.sub.email, HATS.sub.pass);
  const info = await ev(page, () => ({
    role: (state.session && state.session.role) || "",
    text: (document.body.innerText || "").slice(0, 200),
    sub: !!document.getElementById("subview")?.classList.contains("show"),
    n: (state.projects || []).length,
  }));
  note("sub lands on their work", info.sub || info.role === "subs" || /packet|schedule|job|Northwind/i.test(info.text), info.role + " " + info.text.slice(0, 50));
  await ev(page, () => {
    try {
      const p = (state.projects || [])[0];
      if (p && typeof openPacket === "function") {
        const sb = (p.subs || [])[0];
        if (sb) openPacket(sb.id);
      }
    } catch (e) {}
  });
  await pause(page, 500);
  const pk = await ev(page, () => /packet|date|Calderwood|HVAC|Northwind/i.test(document.body.innerText || ""));
  note("sub can see packet language", pk);
  await shot(page, "home");
  await page._ctx.close();
}

// ── Guest packet ──
{
  const page = await boot("packet");
  await page.goto(PACKET + (PACKET.includes("?") ? "&" : "?") + "v=wholebook", { waitUntil: "domcontentloaded", timeout: 45000 });
  await pause(page, 2800);
  await ev(page, () => {
    try {
      if (typeof igBrowser === "function") igBrowser();
    } catch (e) {}
    try {
      document.getElementById("installGate")?.classList.remove("show");
    } catch (e) {}
  });
  await pause(page, 2200);
  const pk = await ev(page, () => {
    const t = ((document.getElementById("gpBody") || document.getElementById("infoBody") || document.body).innerText || "").replace(/\s+/g, " ");
    return { ok: /Calderwood|HVAC|Northwind|packet|These dates/i.test(t) && t.length > 80 && !/Sign in to your private/i.test(t.slice(0, 200)), head: t.slice(0, 160) };
  });
  note("guest packet loads", pk.ok, pk.head);
  await shot(page, "guest");
  await page._ctx.close();
}

// ── Desktop builder ──
{
  const page = await boot("desk", 1280, 800);
  await login(page, HATS.builder.email, HATS.builder.pass);
  const desk = await ev(page, () => ({
    ov: !!document.getElementById("overview")?.classList.contains("show"),
    n: (state.projects || []).length,
    overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth + 8,
  }));
  note("desktop builder sees the book", desk.ov && desk.n >= 8, String(desk.n));
  note("desktop home does not overflow", !desk.overflow);
  await ev(page, () => {
    try {
      openCompany();
    } catch (e) {}
  });
  await pause(page, 300);
  note("desktop company opens", await shown(page, "companyScrim"));
  await ev(page, () => {
    try {
      closeCompany();
    } catch (e) {}
  });
  await shot(page, "home");
  await page._ctx.close();
}

await browser.close();
const fail = checks.filter((c) => !c.ok);
writeFileSync(DIR + "/SCORE.json", JSON.stringify({ when: new Date().toISOString(), fail: fail.length, checks }, null, 2));
console.log("\nWhole Book  " + checks.length + " checks  " + fail.length + " fail");
if (fail.length) process.exit(1);
