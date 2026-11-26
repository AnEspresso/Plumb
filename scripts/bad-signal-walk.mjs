#!/usr/bin/env node
/**
 * Bad Signal Walk — the live two-phone check for 2.530.0 (unsent changes on every house go up when signal returns).
 *
 * Run by hand AFTER 2.530.0 is live. It signs in to siteplumb.com with the QA builder account, so it never runs by
 * accident: nothing happens without --live.
 *
 *   node scripts/bad-signal-walk.mjs --live
 *
 * Two browser contexts ("phone 1" and "phone 2"), both the QA builder. Two throwaway houses ("1 Bad Signal Test Ln",
 * "2 Bad Signal Test Ln"). Playwright's offline switch stands in for no signal. It is not the same as a real dying
 * signal, so a short real-phone airplane-mode check is still worth doing once.
 *
 *   1. phone 1 adds both houses; phone 2 sees both
 *   2. reconnect-all-houses: phone 1 offline, a Field Note on house 1, opens house 2, back online;
 *      house 1's note reaches phone 2 without touching house 1 again
 *   3. pill honesty: Offline · saved here while offline, Saving… after reconnect, then Saved · live,
 *      and Saved · live only when nothing is left unsent
 *   4. same-record conflict on house 2: a daily log written on both phones (phone 1 offline), then one note edited on both
 *   5. cleanup: both houses deleted, gone from both phones
 *   6. a written report (REPORT.md and SCORE.json) in the walk output folder. No credentials in it.
 *
 * Sign-ins come from scripts/walk-secrets.mjs (GitHub Secrets or the untracked .secrets folder). Nothing secret is
 * printed or written. Screenshots and the report go under WALK_OUT, else /workspace/screenshots/bad-signal-walk.
 */
import { mkdirSync, writeFileSync } from "node:fs";

if (!process.argv.includes("--live")) {
  console.log("Bad Signal Walk: signs in to the LIVE site and writes two throwaway houses.");
  console.log("Run it by hand after 2.530.0 is live:  node scripts/bad-signal-walk.mjs --live");
  process.exit(2);
}

const { chromium } = await import("playwright");
const { secret, outDir } = await import("./walk-secrets.mjs");

const TOKEN = secret("appcheck_debug_token");
const BUILDER = { email: secret("qa_email"), pass: secret("qa_password") };
const DIR = outDir("bad-signal-walk");
mkdirSync(DIR, { recursive: true });

const NAME = /Bad Signal Test/i;
const STREET1 = "1 Bad Signal Test Ln";
const STREET2 = "2 Bad Signal Test Ln";
const checks = [];
const findings = [];
const note = (name, ok, detail) => {
  checks.push({ name, ok: !!ok, detail: detail == null ? "" : String(detail).slice(0, 480) });
  console.log((ok ? "PASS" : "FAIL") + "  " + name + (detail ? "  · " + String(detail).slice(0, 220) : ""));
};
const finding = (text) => {
  findings.push(text);
  console.log("NOTE  " + text);
};
// a step that throws is one failed check, not the end of the walk (cleanup still runs)
const step = async (name, fn) => {
  try {
    await fn();
  } catch (e) {
    note(name + " (step stopped)", false, String((e && e.message) || e).split("\n")[0]);
  }
};

const browser = await chromium.launch({
  headless: true,
  args: ["--no-sandbox", "--disable-dev-shm-usage", "--disable-blink-features=AutomationControlled"],
});
const pause = (p, ms) => p.waitForTimeout(ms);
const ev = (p, fn, arg) => (arg === undefined ? p.evaluate(fn) : p.evaluate(fn, arg));
const shot = async (p, n) => {
  try {
    await p.screenshot({ path: `${DIR}/${p._tag}-${n}.png`, fullPage: false });
  } catch (e) {}
};

async function boot(tag) {
  const ctx = await browser.newContext({
    viewport: { width: 390, height: 844 },
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
  return page;
}

async function login(page) {
  await page.goto("https://siteplumb.com/app/?v=badsignal1", { waitUntil: "domcontentloaded", timeout: 45000 });
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
  await page.locator("#laEmail").fill(BUILDER.email, { force: true });
  await page.locator("#laPass").fill(BUILDER.pass, { force: true });
  await ev(page, () => {
    try {
      liveAuthSubmit();
    } catch (e) {}
  });
  await page.waitForFunction(
    () => {
      try {
        return !!(firebase.auth && firebase.auth().currentUser);
      } catch (e) {
        return false;
      }
    },
    undefined,
    { timeout: 35000 },
  );
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
  await page.waitForFunction(
    () => {
      try {
        const r = (state.session && state.session.role) || "";
        return r === "builder" || r === String.fromCharCode(104, 105, 108, 108, 97, 110);
      } catch (e) {
        return false;
      }
    },
    undefined,
    { timeout: 30000 },
  );
  await pause(page, 2500);
  await ev(page, () => {
    try {
      closeStart();
      closeSetup();
    } catch (e) {}
    try {
      showOverview();
    } catch (e) {}
    // what the pill said and when, and every toast, so the walk can read what a person would have seen
    window.__pillLog = [];
    window.__toastLog = [];
    const pill = () => {
      const e = document.querySelector(".syncpill");
      return e ? e.textContent : "";
    };
    let last = "";
    const mark = () => {
      const s = pill();
      if (s !== last) {
        last = s;
        window.__pillLog.push({ at: Date.now(), s });
      }
    };
    mark();
    new MutationObserver(mark).observe(document.body, { subtree: true, childList: true, characterData: true });
    const tt = document.getElementById("toast");
    if (tt)
      new MutationObserver(() => {
        if (tt.classList.contains("show") && tt.textContent) window.__toastLog.push({ at: Date.now(), s: tt.textContent });
      }).observe(tt, { attributes: true, childList: true, characterData: true, subtree: true });
  });
}

const pillOf = (p) => ev(p, () => (document.querySelector(".syncpill") || {}).textContent || "");
const waitPill = (p, text, ms = 45000) =>
  p
    .waitForFunction((t) => ((document.querySelector(".syncpill") || {}).textContent || "") === t, text, { timeout: ms })
    .then(() => true, () => false);
const unsent = (p) => ev(p, () => (typeof Sync !== "undefined" && Sync.unsentHouses ? Sync.unsentHouses().length : -1));
const hasStreet = (p, street) => ev(p, (s) => (state.projects || []).some((x) => (x.street || x.name) === s), street);
const waitStreet = (p, street, ms = 45000) =>
  p.waitForFunction((s) => (state.projects || []).some((x) => (x.street || x.name) === s), street, { timeout: ms }).then(() => true, () => false);
const waitNote = (p, street, text, ms = 45000) =>
  p
    .waitForFunction(
      ([s, t]) => {
        const h = (state.projects || []).find((x) => (x.street || x.name) === s);
        return !!h && (h.items || []).some((i) => String(i.cap || "").indexOf(t) >= 0);
      },
      [street, text],
      { timeout: ms },
    )
    .then(() => true, () => false);
const houseId = (p, street) => ev(p, (s) => ((state.projects || []).find((x) => (x.street || x.name) === s) || {}).id || null, street);
const openHouse = (p, id) =>
  ev(p, (id) => {
    try {
      Data.setActive(id);
    } catch (e) {}
  }, id);

async function addHouse(page, street) {
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

// the same two taps a builder makes: Field Note, type, Send
async function addNote(page, text) {
  await ev(page, (text) => {
    window._tourQuiet = true;
    try {
      openFieldNote();
    } catch (e) {}
    const cap = document.getElementById("caption");
    if (cap) cap.value = text;
    try {
      save();
    } catch (e) {}
    try {
      closeSheet();
    } catch (e) {}
    try {
      document.getElementById("fileToScrim")?.classList.remove("show");
    } catch (e) {}
  }, text);
  await pause(page, 400);
}
async function writeLog(page, text) {
  await ev(page, (text) => {
    try {
      openSheet(true);
      document.getElementById("caption").value = text;
      save();
    } catch (e) {}
  }, text);
  await pause(page, 400);
}
// the house's log for today, as the phone holds it
const todayLog = (p, street) =>
  ev(p, ([s]) => {
    const h = (state.projects || []).find((x) => (x.street || x.name) === s);
    const d = typeof todayStr === "function" ? todayStr() : "";
    const l = h && (h.logs || []).find((x) => x.date === d);
    return l ? String(l.text || "") : "";
  }, [street]);
const notesOf = (p, street) =>
  ev(p, ([s]) => {
    const h = (state.projects || []).find((x) => (x.street || x.name) === s);
    return h ? (h.items || []).map((i) => String(i.cap || "")) : [];
  }, [street]);

// the throwaway houses leave through the same door the app uses (p.deleted), on whichever phone holds them
async function wipeTest(page) {
  return ev(page, () => {
    const gone = [];
    (state.projects || []).slice().forEach((p) => {
      if (!/Bad Signal Test/i.test(p.street || p.name || "")) return;
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
const leftovers = (p) => ev(p, () => (state.projects || []).filter((x) => /Bad Signal Test/i.test(x.street || x.name || "")).map((x) => x.street || x.name));

const p1 = await boot("phone1");
const p2 = await boot("phone2");
let h1 = null;
let h2 = null;

try {
  await step("sign in", async () => {
    await login(p1);
    await login(p2);
    note("phone 1 and phone 2 signed in as the QA builder", true);
    const v1 = await ev(p1, () => String(PLUMB_VERSION));
    const v2 = await ev(p2, () => String(PLUMB_VERSION));
    note("both phones run 2.530.0 or later", /^2\.(5[3-9]\d|[6-9]\d\d)\./.test(v1) && v1.split(" ")[0] === v2.split(" ")[0], v1.split(" ")[0] + " / " + v2.split(" ")[0]);
    if (!/^2\.(5[3-9]\d|[6-9]\d\d)\./.test(v1)) throw new Error("the live app is not 2.530.0 yet. Stop, and run this after the release is live");
  });

  // start clean (a leftover from an earlier run)
  await wipeTest(p1);
  await wipeTest(p2);
  await pause(p1, 1500);

  await step("1. two test houses", async () => {
    h1 = await addHouse(p1, STREET1);
    h2 = await addHouse(p1, STREET2);
    note("phone 1 added both test houses", !!(h1 && h1.id && h2 && h2.id), JSON.stringify({ h1: !!h1, h2: !!h2 }));
    note("phone 1 pill reaches Saved · live", await waitPill(p1, "Saved · live", 60000), await pillOf(p1));
    note("phone 2 sees both houses", (await waitStreet(p2, STREET1)) && (await waitStreet(p2, STREET2)), "");
  });

  await step("2 and 3. reconnect-all-houses and pill honesty", async () => {
    await openHouse(p1, h1.id);
    await pause(p1, 600);
    await p1._ctx.setOffline(true);
    note("phone 1 goes offline: the pill says Offline · saved here", await waitPill(p1, "Offline · saved here", 15000), await pillOf(p1));
    await addNote(p1, "BAD SIGNAL note one, written with no signal");
    await openHouse(p1, h2.id); // drive on to the next house; house 1 is not touched again
    await pause(p1, 500);
    note("offline with an unsent edit: still Offline · saved here (not Saved · live)", (await pillOf(p1)) === "Offline · saved here", await pillOf(p1));
    note("offline: phone 2 does not have the note yet", !(await waitNote(p2, STREET1, "BAD SIGNAL note one", 4000)), "");
    await shot(p1, "offline");
    const t0 = await ev(p1, () => Date.now());
    await p1._ctx.setOffline(false);
    await ev(p1, () => window.dispatchEvent(new Event("online")));
    const log = await ev(p1, (t0) => window.__pillLog.filter((e) => e.at >= t0 - 50).map((e) => e.s), t0);
    const savedFirst = log.indexOf("Saved · live");
    const savingFirst = log.indexOf("Saving…");
    // Saved · live may come only after Saving… (or never be skipped to) while house 1 is still unsent
    note("after reconnect the pill does not jump to Saved · live before Saving…", savedFirst < 0 || (savingFirst >= 0 && savingFirst < savedFirst), JSON.stringify(log));
    const live = await waitPill(p1, "Saved · live", 60000);
    note("the pill ends on Saved · live", live, await pillOf(p1));
    note("when it says Saved · live nothing is left unsent", live && (await unsent(p1)) === 0, String(await unsent(p1)));
    // phone 2 must be able to see house 1's note; the pill was not allowed to say Saved · live before it was on its way
    note("house 1's note reached phone 2 without touching house 1 again", await waitNote(p2, STREET1, "BAD SIGNAL note one", 30000), "");
    const stillOpen = await ev(p1, () => (P() || {}).street || "");
    note("phone 1 was still on house 2 the whole time", stillOpen === STREET2, stillOpen);
    await shot(p1, "reconnected");
  });

  await step("4a. a daily log written on both phones", async () => {
    await openHouse(p1, h2.id);
    await openHouse(p2, h2.id);
    await pause(p1, 800);
    await p1._ctx.setOffline(true);
    await waitPill(p1, "Offline · saved here", 15000);
    await writeLog(p1, "BAD SIGNAL log from phone one");
    await writeLog(p2, "BAD SIGNAL log from phone two");
    await pause(p2, 2500); // phone 2 is online: its log reaches the server
    await ev(p1, () => {
      window.__toastLog = [];
    });
    await p1._ctx.setOffline(false);
    await ev(p1, () => window.dispatchEvent(new Event("online")));
    await waitPill(p1, "Saved · live", 60000);
    await pause(p1, 3000);
    const a = await todayLog(p1, STREET2);
    const b = await todayLog(p2, STREET2);
    const both = (s) => /phone one/.test(s) && /phone two/.test(s);
    note("phone 1 ends with both logs", both(a), JSON.stringify(a));
    note("the server's text is first, then this phone's", both(a) ? a.indexOf("phone two") < a.indexOf("phone one") : false, JSON.stringify(a));
    note("phone 2 ends with both logs too", both(b), JSON.stringify(b));
    const toasts = await ev(p1, () => window.__toastLog.map((x) => x.s));
    note("phone 1 was told both logs are kept", toasts.some((x) => /Both are kept/.test(x)), JSON.stringify(toasts));
    if (!both(a) || !both(b)) {
      finding(
        "FINDING: the two daily logs did not end up on both phones. If phone 1 sent its log before its first read of the server after reconnect, the later write replaced phone 2's text on the server, so phone 2's words were lost. Phone 1 saw: " +
          JSON.stringify(a) + " Phone 2 saw: " + JSON.stringify(b),
      );
    }
    await shot(p1, "log-conflict");
  });

  await step("4b. one note edited on both phones", async () => {
    await openHouse(p1, h2.id);
    await openHouse(p2, h2.id);
    await addNote(p1, "BAD SIGNAL shared note");
    note("phone 2 receives the shared note", await waitNote(p2, STREET2, "BAD SIGNAL shared note", 30000), "");
    await waitPill(p1, "Saved · live", 30000);
    await p1._ctx.setOffline(true);
    await waitPill(p1, "Offline · saved here", 15000);
    const edit = (p, text) =>
      ev(p, (text) => {
        const it = (P().items || []).find((i) => String(i.cap || "").indexOf("BAD SIGNAL shared note") === 0);
        if (it) {
          it.cap = text;
          persist();
        }
        return !!it;
      }, text);
    const e1 = await edit(p1, "BAD SIGNAL shared note, phone one's version");
    const e2 = await edit(p2, "BAD SIGNAL shared note, phone two's version");
    note("both phones edited the note", e1 && e2, "");
    await pause(p2, 2500);
    await ev(p1, () => {
      window.__toastLog = [];
    });
    await p1._ctx.setOffline(false);
    await ev(p1, () => window.dispatchEvent(new Event("online")));
    await waitPill(p1, "Saved · live", 60000);
    await pause(p1, 3000);
    const n1 = await notesOf(p1, STREET2);
    const n2 = await notesOf(p2, STREET2);
    const has = (arr, s) => arr.some((c) => c.indexOf(s) >= 0);
    note("phone 1 keeps phone two's version as the note", has(n1, "phone two's version"), JSON.stringify(n1));
    note("phone 1 saved its own text as a new Field Note starting Your version:", n1.some((c) => /^Your version:.*phone one's version/.test(c)), JSON.stringify(n1));
    note("phone 2 sees both notes too", has(n2, "phone two's version") && has(n2, "phone one's version"), JSON.stringify(n2));
    const toasts = await ev(p1, () => window.__toastLog.map((x) => x.s));
    note("phone 1 was told: Someone else changed this note too", toasts.some((x) => /Someone else changed this note too/.test(x)), JSON.stringify(toasts));
    if (!n1.some((c) => /^Your version:/.test(c)) || !has(n2, "phone one's version")) {
      finding(
        "FINDING: the note edited on both phones did not keep both versions. If phone 1's edit was sent before it read the server's newer copy, it replaced phone 2's edit on the server. Phone 1 saw: " +
          JSON.stringify(n1) + " Phone 2 saw: " + JSON.stringify(n2),
      );
    }
    await shot(p1, "note-conflict");
  });
} finally {
  // 5. cleanup, on both phones, then check both
  try {
    await p1._ctx.setOffline(false);
  } catch (e) {}
  let w1 = [];
  let w2 = [];
  try {
    w1 = await wipeTest(p1);
    await pause(p1, 3000);
    w2 = await wipeTest(p2);
    await pause(p2, 3000);
  } catch (e) {
    console.log("cleanup step stopped: " + String((e && e.message) || e).split("\n")[0]);
  }
  let l1 = [];
  let l2 = [];
  try {
    l1 = await leftovers(p1);
    l2 = await leftovers(p2);
  } catch (e) {}
  note("both Bad Signal test houses are gone from both phones", l1.length === 0 && l2.length === 0, "removed " + w1.concat(w2).join(",") + " leftover phone1=" + l1.join(",") + " phone2=" + l2.join(","));
  if (l1.length || l2.length) {
    finding("LEFTOVER (delete by hand in the QA builder account): " + l1.concat(l2).join(", "));
  }
  note("Calderwood is still on phone 1's book", await ev(p1, () => (state.projects || []).some((x) => /Calderwood/i.test(x.street || x.name || ""))).catch(() => false));
  const fatal = (p1._cons || []).concat(p2._cons || []).filter((x) => /Failed to load module|Uncaught TypeError/i.test(x));
  note("both consoles clean", fatal.length === 0, fatal.slice(0, 2).join(" | "));
  await p1._ctx.close().catch(() => {});
  await p2._ctx.close().catch(() => {});
  await browser.close().catch(() => {});
}

// 6. the written report. Names and counts only: no sign-in, no token, no address.
const fail = checks.filter((c) => !c.ok);
const report = { when: new Date().toISOString(), pass: checks.length - fail.length, fail: fail.length, checks, findings };
writeFileSync(DIR + "/SCORE.json", JSON.stringify(report, null, 2));
const md = [
  "# Bad Signal Walk (2.530.0) — " + new Date().toISOString().slice(0, 16),
  "",
  checks.length - fail.length + "/" + checks.length + " checks. " + fail.length + " fail.",
  "",
  "Two phones (two browser contexts, one QA builder), two throwaway houses. Playwright's offline switch is not a real dying signal: a real-phone airplane-mode and no-bars check is still recommended.",
  "",
  "## Checks",
  ...checks.map((c) => "- " + (c.ok ? "PASS" : "**FAIL**") + " — " + c.name + (c.detail ? " (" + c.detail.replace(/\s+/g, " ").slice(0, 200) + ")" : "")),
  "",
  "## Findings",
  ...(findings.length ? findings.map((f) => "- " + f) : ["- None."]),
  "",
];
writeFileSync(DIR + "/REPORT.md", md.join("\n"));
console.log("\nBad Signal Walk  " + checks.length + " checks  " + fail.length + " fail  ·  " + findings.length + " findings  ·  report in " + DIR);
if (fail.length) process.exit(1);
