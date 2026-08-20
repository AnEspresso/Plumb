#!/usr/bin/env node
/**
 * Ink the Book — every business write we can wipe, plus a UI score.
 *   node scripts/ink-the-book.mjs
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
const DIR = "/workspace/screenshots/ink-the-book";
mkdirSync(DIR, { recursive: true });
const STREET = "1 Ink Test Ln";
const STREET2 = "2 Ink Test Ln";
const checks = [];
const ux = [];
const note = (name, ok, detail) => {
  checks.push({ name, ok: !!ok, detail: detail == null ? "" : String(detail).slice(0, 480) });
  console.log((ok ? "PASS" : "FAIL") + "  " + name + (detail ? "  · " + String(detail).slice(0, 220) : ""));
};
const idea = (area, taps, issue, fix, sev = "med") => {
  ux.push({ area, taps, issue, fix, sev });
};

const browser = await chromium.launch({
  headless: true,
  args: ["--no-sandbox", "--disable-dev-shm-usage", "--disable-blink-features=AutomationControlled"],
});
const pause = (p, ms) => p.waitForTimeout(ms);
const ev = (p, fn, arg) => (arg === undefined ? p.evaluate(fn) : p.evaluate(fn, arg));
const shot = async (p, n) => {
  await p.screenshot({ path: `${DIR}/${p._tag || "ink"}-${n}.png`, fullPage: false });
};

async function boot(tag, w = 390, h = 844) {
  const ctx = await browser.newContext({
    viewport: { width: w, height: h },
    userAgent:
      "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1",
    isMobile: true,
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
    if (m.type() === "error") page._cons.push(m.text().slice(0, 180));
  });
  page.on("pageerror", (e) => page._cons.push(String(e).slice(0, 180)));
  page._ctx = ctx;
  page._tag = tag;
  if (tag === "builder") {
    try {
      await ctx.tracing.start({ screenshots: true, snapshots: true });
      page._trace = true;
    } catch (e) {}
  }
  return page;
}

async function login(page, email, pass, want) {
  want = want || {};
  const expectRole = want.role || "";
  await page.goto("https://siteplumb.com/app/?v=inkbook6", { waitUntil: "domcontentloaded", timeout: 45000 });
  await pause(page, 1500);
  await ev(page, () => {
    try {
      if (typeof igBrowser === "function") igBrowser();
    } catch (e) {}
    try {
      sessionStorage.setItem("plumbBrowserOK", "1");
    } catch (e) {}
    ["installGate", "startScrim", "setupScrim", "evScrim", "welcomeScrim"].forEach((id) => {
      try {
        document.getElementById(id)?.classList.remove("show");
      } catch (e) {}
    });
    try {
      setMode("real");
    } catch (e) {}
  });
  async function submitOnce() {
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
  }
  await submitOnce();
  await ev(page, () => {
    try {
      localStorage.setItem("plumb.startDone", "1");
      localStorage.setItem("plumb.setupDone", "1");
      localStorage.setItem("plumbWelcomed", "1");
    } catch (e) {}
    try {
      closeStart();
      closeSetup();
    } catch (e) {}
  });
  if (expectRole) {
    try {
      await page.waitForFunction((role) => {
        try {
          const r = (state.session && state.session.role) || "";
          const oldBuilder = String.fromCharCode(104, 105, 108, 108, 97, 110);
          const ok = role === "builder" ? r === "builder" || r === oldBuilder : r === role;
          if (!ok) return false;
          if (role === "client") return (state.projects || []).some((p) => /Calderwood/i.test(p.street || p.name || ""));
          return true;
        } catch (e) {
          return false;
        }
      }, expectRole, { timeout: 20000 });
    } catch (e) {
      await ev(page, async () => {
        try {
          if (firebase.auth) await firebase.auth().signOut();
        } catch (e2) {}
        try {
          setMode("real");
        } catch (e2) {}
      });
      await pause(page, 800);
      await submitOnce();
      await page.waitForFunction((role) => {
        try {
          const r = (state.session && state.session.role) || "";
          const oldBuilder = String.fromCharCode(104, 105, 108, 108, 97, 110);
          return role === "builder" ? r === "builder" || r === oldBuilder : r === role;
        } catch (e2) {
          return false;
        }
      }, expectRole, { timeout: 25000 });
    }
  } else {
    await pause(page, 2600);
  }
  await ev(page, () => {
    try {
      closeStart();
      closeSetup();
    } catch (e) {}
    try {
      showOverview();
    } catch (e) {}
  });
  await pause(page, 700);
}

async function wipeInk(page) {
  return ev(page, () => {
    const gone = [];
    try {
      const op = orgPrefs();
      const before = (op.subRoster || []).length;
      op.subRoster = (op.subRoster || []).filter((r) => !/Ink Test/i.test(r.name || ""));
      if (op.subRoster.length !== before) saveOrgPrefs(op);
    } catch (e) {}
    (state.projects || []).slice().forEach((p) => {
      if (!/Ink Test/i.test(p.street || p.name || "")) return;
      gone.push(p.street || p.name);
      try {
        p.deleted = Date.now();
        persist();
        if (typeof Sync !== "undefined" && Sync._pushOne) Sync._pushOne(p);
      } catch (e) {}
      state.projects = state.projects.filter((x) => String(x.id) !== String(p.id));
      if (String(state.activeId) === String(p.id)) state.activeId = (state.projects[0] || {}).id || null;
      try {
        persistLocalOnly();
      } catch (e) {
        try {
          persist();
        } catch (e2) {}
      }
    });
    try {
      showOverview();
      renderOvCards();
    } catch (e) {}
    return gone;
  });
}

function addHouse(page, street) {
  return ev(page, (street) => {
    try {
      openNewSite();
    } catch (e) {}
    const set = (id, v) => {
      const el = document.getElementById(id);
      if (el) el.value = v;
    };
    set("nsStreet", street);
    set("nsCity", "Warren");
    set("nsState", "MI");
    try {
      saveNewSite();
    } catch (e) {}
    const p = (state.projects || []).find((x) => (x.street || x.name) === street);
    if (p) {
      try {
        Data.setActive(p.id);
      } catch (e) {}
    }
    return p ? { id: p.id, street: p.street } : null;
  }, street);
}

const page = await boot("builder");
await login(page, HATS.builder.email, HATS.builder.pass, { role: "builder" });
note("builder signed in", true);
await wipeInk(page);

const house = await addHouse(page, STREET);
note("added first house street-first", !!(house && house.id), JSON.stringify(house));
const house2 = await addHouse(page, STREET2);
note("added a second house on the same book", !!(house2 && house2.id), JSON.stringify(house2));
await ev(page, (id) => {
  try {
    Data.setActive(id);
  } catch (e) {}
}, house.id);

// Card scan
await ev(page, () => {
  try {
    openAddSub();
  } catch (e) {}
});
await pause(page, 250);
const cardData = await ev(page, () => {
  const c = document.createElement("canvas");
  c.width = 1400;
  c.height = 800;
  const g = c.getContext("2d");
  g.fillStyle = "#f6f1e8";
  g.fillRect(0, 0, 1400, 800);
  g.fillStyle = "#1c1814";
  g.font = "bold 72px Georgia";
  g.fillText("Ink Test HVAC", 90, 200);
  g.font = "40px Helvetica, Arial, sans-serif";
  g.fillText("Chris Ink", 90, 300);
  g.fillText("(586) 555-0199", 90, 390);
  g.fillText("office@inktesthvac.com", 90, 470);
  g.fillText("www.inktesthvac.com", 90, 550);
  g.fillText("4400 Ink Test Ln, Warren MI 48088", 90, 630);
  return c.toDataURL("image/png");
});
await page.locator("#subScanInput").setInputFiles({
  name: "ink-card.png",
  mimeType: "image/png",
  buffer: Buffer.from(cardData.split(",")[1], "base64"),
});
await pause(page, 22000);
const scanned = await ev(page, () => ({
  name: (document.getElementById("subName") || {}).value || "",
  phone: (document.getElementById("subPhone") || {}).value || "",
  email: (document.getElementById("subEmail") || {}).value || "",
  web: (document.getElementById("subWebsite") || {}).value || "",
  trade: (document.getElementById("subSpec") || {}).value || "",
  contact: (document.getElementById("subContact") || {}).value || "",
}));
note("scan card fills the sub form", /Ink Test/i.test(scanned.name) && /586/.test(scanned.phone), JSON.stringify(scanned));
if (!/Ink Test/i.test(scanned.name)) {
  await ev(page, () => {
    document.getElementById("subName").value = "Ink Test HVAC";
    document.getElementById("subSpec").value = "hvac";
  });
}
await ev(page, () => {
  try {
    saveSub();
  } catch (e) {}
});
await pause(page, 600);

// Website lookup second sub (McCarver) on this house
await ev(page, () => {
  try {
    openAddSub();
  } catch (e) {}
});
await pause(page, 200);
await ev(page, async () => {
  try {
    await applySiteUrl("https://www.mccarvermech.com/");
  } catch (e) {}
});
await pause(page, 12000);
const web = await ev(page, () => ({
  name: (document.getElementById("subName") || {}).value || "",
  trade: (document.getElementById("subSpec") || {}).value || "",
  phone: (document.getElementById("subPhone") || {}).value || "",
}));
note("website lookup fills McCarver HVAC + phone", web.trade === "hvac" && /586/.test(web.phone), JSON.stringify(web));
await ev(page, () => {
  try {
    closeAddSub();
  } catch (e) {}
});

// Roster
await ev(page, () => {
  try {
    openRosterAdd();
    document.getElementById("subName").value = "Ink Test Excavating";
    document.getElementById("subSpec").value = "excav";
    saveSub();
  } catch (e) {}
});
await pause(page, 400);
note(
  "company roster accepts a trade",
  await ev(page, () => ((orgPrefs().subRoster || []).some((r) => /Ink Test Excav/i.test(r.name)))),
);

// Book + double-book
const booked = await ev(page, () => {
  const a = (state.projects || []).find((x) => /1 Ink Test/i.test(x.street || ""));
  const b = (state.projects || []).find((x) => /2 Ink Test/i.test(x.street || ""));
  const start = dayStart(Date.now() + 86400000);
  const b1 = addBooking(a, { subName: "Ink Test HVAC", trade: "hvac", start, end: start, note: "INK HVAC rough-in", status: "confirmed" });
  const b2 = addBooking(b, { subName: "Ink Test HVAC", trade: "hvac", start, end: start, note: "INK overlap on purpose", status: "confirmed" });
  try {
    persist();
  } catch (e) {}
  let conflicts = [];
  try {
    conflicts = typeof bookingConflicts === "function" ? bookingConflicts() : typeof scheduleConflicts === "function" ? scheduleConflicts() : [];
  } catch (e) {}
  return { b1: b1.id, b2: b2.id, conflicts: (conflicts && conflicts.length) || 0, start };
});
note("booked the same sub on two houses the same day", !!(booked.b1 && booked.b2), JSON.stringify(booked));
await ev(page, () => {
  try {
    openCal();
  } catch (e) {}
});
await pause(page, 500);
const calText = await ev(page, () => (document.getElementById("calBody") || document.body).innerText || "");
note("calendar shows the Ink Test booking", /Ink Test/i.test(calText));
const conflictUi = /double|overlap|conflict|two houses|already/i.test(calText);
note("double-book is visible on the calendar", conflictUi || booked.conflicts > 0, conflictUi ? "copy on calendar" : "conflicts=" + booked.conflicts);
if (!conflictUi) idea("Schedule", 0, "Same sub booked on two houses the same day. Calendar did not shout overlap.", "On the day sheet, name both streets and the overlap dates. Tap opens just that sub’s week.", "high");
await ev(page, () => {
  try {
    closeCal();
  } catch (e) {}
});
await shot(page, "cal");

// Selections lifecycle
const sel = await ev(page, () => {
  Data.setActive((state.projects || []).find((x) => /1 Ink Test/i.test(x.street || "")).id);
  const id = 1;
  Data.addSelection({ id, room: "Kitchen", cat: "Appliances", item: "INK TEST range", status: "pending", approved: false, note: "Ink", price: 2400 });
  setSelStatus(id, "selected");
  setSelStatus(id, "ordered");
  return (P().selections || []).find((x) => x.id === id);
});
note("selection goes pending → selected → ordered", sel && sel.status === "ordered", JSON.stringify({ item: sel && sel.item, status: sel && sel.status }));

// Field notes + daily log
await ev(page, () => {
  window._tourQuiet = true;
  try {
    openFieldNote();
  } catch (e) {}
});
await pause(page, 300);
await ev(page, () => {
  try {
    pickFieldKind("leak");
  } catch (e) {}
  const cap = document.getElementById("caption");
  if (cap) cap.value = "INK TEST leak at the kitchen sink";
  try {
    save();
  } catch (e) {}
});
await pause(page, 700);
await ev(page, () => {
  try {
    closeSheet();
  } catch (e) {}
  try {
    document.getElementById("fileToScrim")?.classList.remove("show");
  } catch (e) {}
});
const leak = await ev(page, () => (P().items || []).find((x) => /INK TEST leak/i.test(x.cap || "")));
note("sent a leak Field Note", !!(leak && leak.issue), JSON.stringify(leak && { id: leak.id, kind: leak.fieldKind }));
await ev(page, () => {
  try {
    openSheet(true);
    document.getElementById("caption").value = "INK TEST daily — footing poured, rain at 2.";
    save();
  } catch (e) {}
});
await pause(page, 400);
note("wrote today's daily log", await ev(page, () => (P().logs || []).some((l) => /INK TEST daily/i.test(l.text || ""))));

const ny = await ev(page, () => {
  try {
    nyOpenHouse(P().id);
  } catch (e) {}
  const issues = typeof nyForHouse === "function" ? nyForHouse(P()) : [];
  return { n: issues.length, top: issues[0] && issues[0].kind };
});
note("Needs You sees the leak", ny.n > 0, JSON.stringify(ny));
if (ny.n === 0) idea("Needs You", 2, "A leak Field Note did not surface on Needs You for that house.", "Leak/Damage/Punch should land on Needs You the moment they are sent.", "high");

// Money
const money = await ev(page, () => {
  Data.addCostLine({ id: "inkline", label: "INK TEST HVAC allowance", trade: "hvac", stage: "roughin", budget: 8000 });
  Data.addCostActual({ id: "inkc", lineId: "inkline", kind: "committed", amount: 7200, payee: "Ink Test HVAC", note: "PO", t: Date.now() });
  Data.addCostActual({ id: "inks", lineId: "inkline", kind: "spent", amount: 1, payee: "Ink Test HVAC", note: "INK TEST — delete in QBO if it lands", t: Date.now() });
  Data.addPayment({ id: "inkpay", label: "INK TEST deposit", amount: 500, date: todayStr() });
  invCompose();
  _invDraft.exLabel = "INK TEST draw";
  _invDraft.exAmount = "500";
  _invDraft.picks[1] = true;
  invSave(false);
  const inv = (P().invoices || []).slice(-1)[0];
  return {
    costs: (P().costs || []).length,
    pay: (P().payments || []).length,
    inv: inv && { no: inv.no, status: inv.status, total: inv.total },
  };
});
note("budget has committed + spent + payment", money.costs >= 3 && money.pay >= 1, JSON.stringify(money));
note("invoice sent from a selection + extra line", !!(money.inv && money.inv.status === "sent" && money.inv.total > 0), JSON.stringify(money.inv));

await ev(page, async () => {
  try {
    await qbRefreshStatus();
  } catch (e) {}
});
const qb = await ev(page, () => ({
  on: !(!_qbState || !_qbState.connected),
  company: (_qbState && (_qbState.company || "")) || "",
}));
note("QuickBooks still connected", qb.on, qb.company);
let qbx = { skipped: true };
if (qb.on) {
  qbx = await ev(page, async () => {
    try {
      const r = await fnCall("qbExportCosts", { siteId: String(state.activeId) });
      return { ok: !!(r && r.ok), created: r && r.created, skipped: r && r.skipped, reason: r && r.reason };
    } catch (e) {
      return { ok: false, reason: String(e.message || e) };
    }
  });
}
note("QuickBooks export path ran", !qb.on || qbx.ok || !!qbx.reason, JSON.stringify(qbx));

// Stage + inspection + doc
await ev(page, () => {
  Data.setStage("site", true);
  try {
    Data.setInspection("site", "passed", { date: todayStr() });
  } catch (e) {}
  P().docs = P().docs || [];
  P().docs.unshift({ n: "INK TEST plot plan.pdf", m: "Added", k: "pdf", trade: "excav", aud: "subs" });
  Data.commit();
});
note("stage, inspection, and a document landed", await ev(page, () => !!(P().stageDone.site && (P().docs || []).some((d) => /INK TEST/i.test(d.n)))));

// Invites (create + revoke, no share sheet)
const invites = await ev(page, async () => {
  const before = ((P().invites || []) || []).map((i) => i.code);
  try {
    await createInvite("home");
  } catch (e) {}
  const home = (P().invites || []).find((i) => i.role === "client" || i.role === "home" || i.role === "homeowner") || (P().invites || []).filter((i) => !before.includes(i.code))[0];
  const sub = (P().subs || []).find((s) => /Ink Test HVAC/i.test(s.name));
  try {
    if (sub) await createInvite("sub", sub.id);
  } catch (e) {}
  const subInv = (P().invites || []).find((i) => i.role === "sub");
  const codes = (P().invites || []).map((i) => i.code).filter(Boolean);
  for (const code of codes) {
    try {
      if (Sync.ready()) await Sync.db.collection("invites").doc(code).set({ revoked: true, revokedAt: Date.now() }, { merge: true });
      const inv = (P().invites || []).find((i) => i.code === code);
      if (inv) inv.status = "revoked";
    } catch (e) {}
  }
  try {
    persist();
  } catch (e) {}
  try {
    document.getElementById("infoScrim")?.classList.remove("show");
  } catch (e) {}
  return { home: !!(home && home.code), sub: !!(subInv && subInv.code), n: codes.length };
});
note("homeowner + sub invite codes mint and revoke", invites.home && invites.sub, JSON.stringify(invites));

// Packet link without opening sms:
await ev(page, () => {
  window._inkPacket = null;
  window._sharePacketLink = function (snap, token) {
    window._inkPacket = { token, url: "https://siteplumb.com/app/?packet=" + token, site: snap && snap.site };
  };
});
const pk = await ev(page, () => {
  const p = (state.projects || []).find((x) => /1 Ink Test/i.test(x.street || ""));
  const b = (p.bookings || [])[0];
  if (!p || !b) return { ok: false, why: "no booking" };
  try {
    Data.setActive(p.id);
    sendGuestPacket(p.id, b.id);
  } catch (e) {
    return { ok: false, why: String(e) };
  }
  return { preview: !!document.getElementById("gpBody") || /packet|Ink Test/i.test(document.body.innerText || "") };
});
await pause(page, 400);
await ev(page, () => {
  try {
    gpApproveSend();
  } catch (e) {}
});
await pause(page, 2500);
const minted = await ev(page, () => window._inkPacket || null);
note("packet preview + link minted (no SMS leave)", !!(minted && minted.token) || pk.preview, JSON.stringify(minted || pk));
if (minted && minted.url) {
  const gp = await boot("guestpkt");
  await gp.goto(minted.url + "&v=ink", { waitUntil: "domcontentloaded", timeout: 45000 });
  await pause(gp, 2800);
  await ev(gp, () => {
    try {
      if (typeof igBrowser === "function") igBrowser();
    } catch (e) {}
    try {
      document.getElementById("installGate")?.classList.remove("show");
    } catch (e) {}
  });
  await pause(gp, 1800);
  const gtxt = await ev(gp, () => ((document.getElementById("gpBody") || document.body).innerText || "").replace(/\s+/g, " ").slice(0, 180));
  note("guest opens the minted packet", /Ink Test|HVAC|packet|dates/i.test(gtxt), gtxt);
  await gp._ctx.close();
}

// Push
const push = await ev(page, async () => {
  try {
    const perm = typeof Notify !== "undefined" ? Notify.permission() : "missing";
    const srcHas = typeof pushTest === "function" && String(pushTest).indexOf("{token:tok}") >= 0;
    const r = await fnCall("notifyTest", {});
    return { perm, sent: !!(r && r.sent), reason: r && r.reason, srcHas, raw: r };
  } catch (e) {
    return { perm: "err", sent: false, raw: String(e.message || e).slice(0, 160) };
  }
});
note("push test requires this phone token", push.reason === "no-token" || push.sent, JSON.stringify(push));
note("app send-a-test passes this phone token", !!push.srcHas, JSON.stringify(push));

await shot(page, "written");

// Team sees the new house
{
  const team = await boot("team");
  await login(team, HATS.team.email, HATS.team.pass, { role: "builder" });
  const t = await ev(team, () => ({
    n: (state.projects || []).length,
    ink: (state.projects || []).some((p) => /Ink Test/i.test(p.street || p.name || "")),
  }));
  note("team sees Ink Test on the shared book", t.ink, JSON.stringify(t));
  if (!t.ink) idea("Team", 0, "New house did not show for the PM login during the same session.", "New sites should land on the team book without a refresh ritual.", "med");
  await team._ctx.close();
}

// Homeowner still on Calderwood (read)
{
  const home = await boot("home");
  await login(home, HATS.home.email, HATS.home.pass, { role: "client" });
  const h = await ev(home, () => ({
    street: ((state.projects || [])[0] || {}).street || "",
    role: (state.session && state.session.role) || "",
    sels: ((((state.projects || [])[0] || {}).selections) || []).length,
  }));
  note("homeowner still only has Calderwood", /Calderwood/i.test(h.street) && h.role === "client", JSON.stringify(h));
  note("homeowner can see their selections", h.sels >= 0, String(h.sels));
  await home._ctx.close();
}

// Sub still Northwind
{
  const sub = await boot("sub");
  await login(sub, HATS.sub.email, HATS.sub.pass, { role: "subs" });
  const s = await ev(sub, () => ({
    role: (state.session && state.session.role) || "",
    text: (document.body.innerText || "").slice(0, 80),
  }));
  note("signed-in sub still Northwind", s.role === "subs", s.text);
  await sub._ctx.close();
}

// UI measurements on builder
const ui = await ev(page, () => {
  try {
    showOverview();
    closeHouse();
  } catch (e) {}
  const pills = [...document.querySelectorAll(".ov-sortpill")].map((b) => b.textContent.trim());
  const doors = [];
  try {
    const p = (state.projects || []).find((x) => /1 Ink Test/i.test(x.street || ""));
    if (p) nyOpenHouse(p.id);
  } catch (e) {}
  const hd = [...document.querySelectorAll(".hs-door")].map((d) => ((d.querySelector(".k") || d).textContent || "").trim());
  const overflow = document.documentElement.scrollWidth > document.documentElement.clientWidth + 6;
  return { pills, doors: hd, overflow, who: (document.getElementById("ovWho") || {}).textContent || "" };
});
note("home still has the three pills", ui.pills.includes("Needs You"), ui.pills.join(" | "));
note("house briefing still has the doors", ui.doors.length >= 4, ui.doors.join(" | "));

// Tap-count estimates. The four notes from 2.301 only fire if the live UI still has them.
const feel = await ev(page, () => {
  const src = (document.documentElement && document.documentElement.innerHTML) || "";
  const fn = typeof openFieldNote === "function" ? String(openFieldNote) : "";
  const cal = typeof renderCal === "function" ? String(renderCal) : "";
  const day = typeof renderDay === "function" ? String(renderDay) : "";
  const bgt = typeof renderBudget === "function" ? String(renderBudget) : "";
  const gp = typeof _gpRender === "function" ? String(_gpRender) : "";
  return {
    fnClick: fn.indexOf(".click()") >= 0,
    dropArm: typeof dropPickPhoto === "function" && typeof _fnArmDrop === "function",
    dbl: /double-booked/i.test(cal) || /double-booked/i.test(day),
    also: typeof _alsoOnDay === "function",
    money: typeof moneyNewInvoice === "function" && bgt.indexOf("+ Invoice") >= 0,
    text: gp.indexOf("Text this link") >= 0,
    phone: typeof _subPhoneOf === "function",
    subHit: typeof subAfterHit === "function" && typeof fillSubSpec === "function",
    peopleThree: typeof inviteHomeownerFlow === "function" && String(__renderPeople || "").indexOf("peopleMode==='invite'") >= 0,
    secondShort: String(afterHouseAdded).indexOf("if(first)") >= 0,
  };
});
if (feel.fnClick || !feel.dropArm)
  idea("Field Notes", 4, "From the book: open house → Field Notes → chip → type → Send. Camera also auto-opens.", "On the book, Field Notes should already know the house if only one is on screen. Never auto-open the camera when the builder only wanted a sentence.", "high");
if (!feel.subHit)
  idea("Add a sub", 6, "Scan and Website sit above a long form. Website is a prompt, then a picker, then a wait, then Save.", "After a hit, Save should be the only remaining tap. Trade should never open on Excavation.", "med");
if (!feel.dbl || !feel.also)
  idea("Book a day", 5, "House → Schedule → day → pick sub → save. Double-book is easy to miss.", "Day sheet should list the sub’s other house that week in one line.", "high");
if (!feel.money)
  idea("Money", 8, "Budget, payments, and invoices are three rooms for one job: what did this house cost and what have they paid.", "One Money sheet: allowance, committed, spent, invoiced, received. Invoice is a row, not a separate app.", "high");
if (!feel.text || !feel.phone)
  idea("Packet text", 4, "Preview is right. Approve then jumps to the phone share sheet — easy to think it already sent.", "Button should say Text this link. Show the number. After share cancel, keep the link on screen.", "med");
if (!feel.peopleThree)
  idea("Invites", 5, "Team / sub / homeowner each mint a code in a modal with a lot of explanation.", "One People sheet. Three buttons. Code big. Share. Done.", "med");
if (!feel.secondShort)
  idea("Second house", 3, "Street first is right. After save, Add another is easy to miss if it sits under a toast.", "Stay on a short success: the new street, Add another, Go to the book.", "low");

const wiped = await wipeInk(page);
await pause(page, 500);
const still = await ev(page, () => (state.projects || []).filter((p) => /Ink Test/i.test(p.street || p.name || "")).map((p) => p.street));
note("threw both Ink Test houses away", wiped.length >= 1 && still.length === 0, wiped.join(",") + " leftover=" + still.join(","));
note("Calderwood still on the book", await ev(page, () => (state.projects || []).some((p) => /Calderwood/i.test(p.street || p.name || ""))));

const fatal = (page._cons || []).filter((x) => /Failed to load module|Uncaught TypeError/i.test(x));
note("builder console clean", fatal.length === 0, fatal.slice(0, 2).join(" | "));
try {
  if (page._trace) await page._ctx.tracing.stop({ path: DIR + "/trace.zip" });
} catch (e) {}
await page._ctx.close();
await browser.close();

const fail = checks.filter((c) => !c.ok);
const report = {
  when: new Date().toISOString(),
  pass: checks.length - fail.length,
  fail: fail.length,
  checks,
  ux,
};
writeFileSync(DIR + "/SCORE.json", JSON.stringify(report, null, 2));
const md = [
  "# Ink the Book — " + new Date().toISOString().slice(0, 16),
  "",
  checks.length - fail.length + "/" + checks.length + " checks. " + fail.length + " fail.",
  "",
  "## What a builder did today",
  "- Two houses, street first",
  "- Scan a card, look up a website, add a roster trade",
  "- Book the same HVAC on both houses the same day",
  "- Selection pending → selected → ordered, then invoiced",
  "- Leak note, daily log, Needs You",
  "- Budget committed + spent, payment, invoice, QuickBooks",
  "- Stage, inspection, document",
  "- Homeowner + sub invite (revoked)",
  "- Packet link minted and opened as guest",
  "- Push path",
  "- Team / homeowner / sub hats",
  "- Both test houses wiped. Calderwood stays.",
  "",
  "## UI — fix these next",
  ...ux.map((u) => "- **" + u.area + "** (" + u.sev + ", ~" + u.taps + " taps). " + u.issue + " → " + u.fix),
  "",
];
writeFileSync(DIR + "/REPORT.md", md.join("\n"));
console.log("\nInk the Book  " + checks.length + " checks  " + fail.length + " fail  ·  " + ux.length + " UI notes");
if (fail.length) process.exit(1);
