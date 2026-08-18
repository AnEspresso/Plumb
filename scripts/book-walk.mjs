#!/usr/bin/env node
/**
 * The Book Walk — full public QA, every hat, forward and back.
 *   node scripts/book-walk.mjs
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
const DIR = "/workspace/screenshots/book-walk";
mkdirSync(DIR, { recursive: true });
const checks = [];
const note = (name, ok, detail) => {
  checks.push({ name, ok: !!ok, detail: detail == null ? "" : String(detail).slice(0, 400) });
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
const show = (p, id) => ev(p, (id) => !!document.getElementById(id)?.classList.contains("show"), id);

async function boot(tag, w = 390, h = 844) {
  const ctx = await browser.newContext({
    viewport: { width: w, height: h },
    userAgent:
      "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1",
    isMobile: w < 500,
    hasTouch: true,
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
  await page.goto("https://siteplumb.com/app/?v=bookwalk", { waitUntil: "domcontentloaded", timeout: 45000 });
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

// ── Marketing ──
{
  const page = await boot("mkt", 390, 844);
  await page.goto("https://siteplumb.com/?v=bookwalk", { waitUntil: "domcontentloaded", timeout: 30000 });
  await pause(page, 800);
  const mkt = await ev(page, () => {
    const bar = document.getElementById("shipBar");
    const cs = bar ? getComputedStyle(bar).display : "missing";
    return {
      bar: cs,
      lab: document.body.classList.contains("lab"),
      hero: (document.querySelector("h1") || {}).textContent || "",
    };
  });
  note("marketing has no public version bar", mkt.bar === "none", mkt.bar);
  note("marketing hero is the product", /client|update|build/i.test(mkt.hero), mkt.hero.slice(0, 80));
  await shot(page, "home");
  await page._ctx.close();
}

// ── Demo: no tour offer ──
{
  const page = await boot("demo");
  await page.goto("https://siteplumb.com/app/?demo=1&v=bookwalk", { waitUntil: "domcontentloaded", timeout: 45000 });
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
    walk: typeof walkAllowed === "function" ? walkAllowed() : "n/a",
  }));
  note("demo does not offer the walk to the public", demo.intro === false, JSON.stringify(demo));
  await shot(page, "home");
  await page._ctx.close();
}

// ── Builder hat ──
{
  const page = await boot("builder");
  await login(page, HATS.builder.email, HATS.builder.pass);
  const bootInfo = await ev(page, () => ({
    ver: (typeof PLUMB_VERSION === "string" && PLUMB_VERSION.split(" ")[0]) || "",
    n: (state.projects || []).length,
    who: (document.getElementById("ovWho") || {}).textContent || "",
    settingsWalk: false,
  }));
  await ev(page, () => {
    try {
      openSettings();
    } catch (e) {}
  });
  await pause(page, 300);
  const sets = await ev(page, () => {
    const t = (document.getElementById("settingsBody") || {}).innerText || "";
    return { walk: /How SitePlumb works|Walkthrough studio|Classic walkthrough/i.test(t), bench: /Workbench/i.test(t) };
  });
  note("builder is signed in", bootInfo.n >= 0, "v" + bootInfo.ver + " sites " + bootInfo.n);
  note("builder QA can still see the walk in Settings", sets.walk === true, JSON.stringify(sets));
  await ev(page, () => {
    try {
      closeSettings();
    } catch (e) {}
  });

  await ev(page, () => {
    const p = (state.projects || []).find((x) => /Calderwood/i.test(x.street || x.name || "")) || (state.projects || [])[0];
    if (p) {
      try {
        nyOpenHouse(p.id);
      } catch (e) {
        try {
          openSiteFromOverview(p.id);
        } catch (e2) {}
      }
    }
  });
  await pause(page, 600);
  const house = await ev(page, () => ({
    brief: !!document.getElementById("houseScrim")?.classList.contains("show") || !!document.getElementById("houseSheet")?.classList.contains("show"),
    site: !!document.getElementById("site")?.classList.contains("show") || !!document.querySelector(".site.show"),
    text: (document.body.innerText || "").slice(0, 200),
  }));
  note("builder can open a house", house.brief || house.site, house.text.slice(0, 80));
  await shot(page, "house");

  // doors then back
  const doors = ["Schedule", "Selections", "Money", "Field Notes"];
  for (const d of doors) {
    const hit = await ev(page, (label) => {
      const b = [...document.querySelectorAll("button, .door, .tf-doors span, [data-door]")].find((el) =>
        (el.innerText || "").includes(label)
      );
      if (b) {
        b.click();
        return true;
      }
      return false;
    }, d);
    await pause(page, 400);
    note("builder door " + d, hit, hit ? "opened" : "not on this sheet");
    await ev(page, () => {
      try {
        closeCal();
      } catch (e) {}
      try {
        closeBudget();
      } catch (e) {}
      try {
        closeSheet();
      } catch (e) {}
      try {
        document.getElementById("selScrim")?.classList.remove("show");
      } catch (e) {}
    });
  }

  await ev(page, () => {
    try {
      closeHouse();
      showOverview();
    } catch (e) {}
  });
  await pause(page, 400);
  note("builder back to the book", await ev(page, () => !!document.getElementById("overview")?.classList.contains("show")));
  await shot(page, "back-home");

  await ev(page, () => {
    try {
      openCompany();
    } catch (e) {}
  });
  await pause(page, 300);
  const co = await ev(page, () => {
    const t = (document.getElementById("companyBody") || {}).innerText || "";
    return { on: !!document.getElementById("companyScrim")?.classList.contains("show"), trades: /Trades Calendar|Subcontractors|Invoices/i.test(t) };
  });
  note("builder company drawer", co.on && co.trades, JSON.stringify(co));
  await ev(page, () => {
    try {
      closeCompany();
    } catch (e) {}
  });

  // add-sub sheet exists
  await ev(page, () => {
    try {
      openAddSub();
    } catch (e) {}
  });
  await pause(page, 300);
  const subModal = await ev(page, () => ({
    on: !!document.getElementById("subScrim")?.classList.contains("show"),
    scan: /Scan card/i.test(document.body.innerText || ""),
    web: /Website/i.test(document.body.innerText || ""),
    trade: (document.getElementById("subSpec") || {}).value || "",
    guess: typeof guessTrade === "function" ? guessTrade("McCarver Mechanical Heating Cooling") : "",
  }));
  note("add-sub has scan + website", subModal.on && subModal.scan && subModal.web, JSON.stringify(subModal));
  note("blank add-sub does not pick Excavation", subModal.trade === "", subModal.trade || "empty");
  note("McCarver name guesses HVAC, not excav", subModal.guess === "hvac", subModal.guess || "guessTrade missing");
  await ev(page, () => {
    try {
      closeAddSub();
    } catch (e) {}
  });
  await page._ctx.close();
}

// ── Team hat ──
{
  const page = await boot("team");
  await login(page, HATS.team.email, HATS.team.pass);
  const info = await ev(page, () => ({
    n: (state.projects || []).length,
    ov: !!document.getElementById("overview")?.classList.contains("show"),
    role: (state.session && state.session.role) || "",
  }));
  note("team sees the book", info.n > 0 && info.ov, JSON.stringify(info));
  await shot(page, "home");
  await ev(page, () => {
    try {
      closeHouse();
      showOverview();
    } catch (e) {}
  });
  note("team back to the book", await ev(page, () => !!document.getElementById("overview")?.classList.contains("show")));
  await page._ctx.close();
}

// ── Homeowner hat ──
{
  const page = await boot("home");
  await login(page, HATS.home.email, HATS.home.pass);
  const info = await ev(page, () => ({
    client: !!document.getElementById("clientview")?.classList.contains("show") || (state.session && state.session.role) === "client",
    text: (document.body.innerText || "").slice(0, 160),
  }));
  note("homeowner lands on their house", info.client || /Calderwood|home/i.test(info.text), info.text.slice(0, 80));
  await shot(page, "home");
  await page._ctx.close();
}

// ── Sub hat ──
{
  const page = await boot("sub");
  await login(page, HATS.sub.email, HATS.sub.pass);
  const info = await ev(page, () => ({
    sub: !!document.getElementById("subview")?.classList.contains("show") || (state.session && state.session.role) === "subs",
    text: (document.body.innerText || "").slice(0, 160),
  }));
  note("sub lands on their work", info.sub || /schedule|packet|job/i.test(info.text), info.text.slice(0, 80));
  await shot(page, "home");
  await page._ctx.close();
}

await browser.close();
const fail = checks.filter((c) => !c.ok);
writeFileSync(DIR + "/SCORE.json", JSON.stringify({ fail: fail.length, checks }, null, 2));
console.log("\nBook Walk  " + checks.length + " checks  " + fail.length + " fail");
if (fail.length) process.exit(1);
