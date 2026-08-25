# SitePlumb spoken tour — kit for GrokBots

Build this against: **live app 2.332.0+** at `https://siteplumb.com/app/index.html`
Script source of truth: `app/tour-audio/cues.json` (paste it with this file)
Engine: `app/index.html` functions `startGrandTour`, `TOUR.team`, `tourPlayCues`, `tourSceneRect`, `tourStageRect`, `tourAvoidCover`, `tourPoint`, `tourWaitTap`
Voice: Ara mp3s in `app/tour-audio/s1a.mp3` … `s10c.mp3`. Rebake: `python3 scripts/bake-tour-voice.py --force`
Do **not** resurrect the 16-slide Full site walk (`TOUR.grand` / Classic walkthrough).

---

## What the tour is for

A builder (custom home / remodel, 8th-grade English) should finish this walk and feel:

1. I know the daily habit (Field Notes).
2. I know my book of houses.
3. I know one house = one briefing, not a website of tabs.
4. I know the packet is what the crew sees, live.
5. I know where desk work lives (the rest of this house + Company).
6. I can skip anytime. Nothing here can break. Replay is in Settings.

If they cannot do those six things after one walk, the tour failed — even if the gold box is pretty.

Most important features, in this order. Do not add more slides.
Field Notes → book (Needs You / Recent decisions / A–Z) → tap a house → briefing → On the job doors (Field Notes, Schedule, Selections, Money) → still open / packet → the rest of this house → Company.

Ease of use must be *shown*, not claimed. One camera. One house. Skip is always there. Next is the only way forward. The user’s tap is the only press.

---

## The live map (do not invent UI)

Book of houses. One house = one briefing. Doors, not tabs.
**On the job:** Field Notes · Schedule · Selections · Money — two across.
**The rest of this house:** Progress · Daily log · Photos · Documents · Permits · Crews on this house · Open items.
**Company** is the office drawer (briefcase), not a house.
No Full site. No Log / Needs You / Build / Files tabs on a house. No Billing. No chip (say **label**). Crew, not sub (unless you mean that one trade). Name the person: builder, homeowner, crew.

---

## Ten slides (do not add an 11th)

| # | Title | Landmark | User should leave knowing |
|---|---|---|---|
| 1 | Glad you're here | Coming up card | This is a short walk. Skip is safe. |
| 2 | Field Notes | Camera on the book | House, photo, a label, Send. Same camera everywhere. **She asks; their tap opens it.** |
| 3 | Your book | Three pills only | Needs You · Recent decisions · A–Z. |
| 4 | The houses | All homes row | Tap a house for a briefing. You do not open the whole site. |
| 5 | The briefing | Still open / next-on-site | One house. What still needs you, then the doors. |
| 6 | The doors | ON THE JOB + four doors | Schedule, Selections, Money, Field Notes — this house only. |
| 7 | The packet | Still open list | What the **crew** sees. Live. No text thread. |
| 8 | The rest of this house | That heading + that door grid | Desk work on this street. You do not start here. Done is not in the gold box. |
| 9 | Company | Briefcase, then office rows | Calendar, invoices, roster, team. Stays open until Next. |
| 10 | You're set | Coming up again | Replay from Settings. Hat still Builder. Got it just ends. |

Voice files: s1a–s1c, s2a–s2d, s3a–s3d, s4a–s4b, s5a–s5c, s6a–s6e, s7a–s7b, s8a–s8e, s9a–s9c, s10a–s10c.

---

## Peter's tour laws (fail any break)

**Stage (gold box)**
- Frames the landmark, not one pixel, not the whole phone.
- Snap to cards. Never cut a card, row, or door in half.
- Do not stretch the gold box to dodge the card. The **card** moves.
- House slides stay on the briefing. Company: close the house first.
- Done button is never inside the gold box.

**Orb**
- Circle = look. Tap/invite = do this now (only the user’s tap). Underline = read this label.
- Moves WITH the voice. Never underline the gold box, a photo, or a number.

**Voice**
- Unlock on the same tap as Replay. No second hello. No freeze after “Glad you're here.”
- One line at a time. Ara mp3s only. No robot voice.
- Card and clip must match. 8th-grade English. Name the person. label not chip. the rest of this house not Full site. crew not sub.

**Card**
- Least important band. Never on the gold box. Fully on screen (counter visible).
- Skip always (slides 1–9). Next never traps you. Got it ends on Coming up.

**After the walk**
- Coming up sits where it started. Hat is Builder. Replay a second time is still 1/10 Glad you're here.

---

## Known freeze (fix this first)

On iPhone, Replay used to wait on `cues.json` then iOS killed audio after s1a. 2.331+ starts on the tap. Slide 1 must **not** `point` at `#ovToday` (that card is huge and `awaitSettle` / `tourPoint` hangs the walk). Voice must play s1a, s1b, s1c, then wait for Next. Next must work on a phone.

If it still freezes: `tourPlayFile` never resolving, or `waitTap` / `tourPoint` without a timeout. Cap every wait. Never block Next.

---

## How many bots: **three**. Not four. Not all at once.

| Bot | Owns | Does not |
|---|---|---|
| **1. Tour Words** (your SitePlumb Words) | `cues.json` titles, bodies, `say`. Teaching order. 8th-grade. Name the person. | Gold box math. Engine. Shipping. |
| **2. Tour Ink** (your SitePlumb Ink) | Gold box, orb, card. `tourSceneRect` / `tourStageRect` / `tourAvoidCover`. Landmarks in the table above. | Rewriting the story. New slides. |
| **3. Tour Desk** (your SitePlumb Desk) | Walks the **live** app on phone + laptop. Census only. Freeze, gold, card, orb, leftover words. | Any code. |

**This chat (Grok Build) is the only shipper.** Bots return a patch or a census. They do not push GitHub.

### Order of work (do not parallel-edit)

1. **Desk** walks 2.332+ once. Freeze? Stop. Report. Do not redesign.
2. **Words** locks the ten-slide script so a first-time builder would get the six takeaways. Paste `cues.json`. Shorten, do not add slides.
3. **Ink** places gold/orb/card on that locked script. Paste this kit + `cues.json` + the tour functions from `index.html`.
4. **Desk** runs the gold/card/orb census again (one still per slide).
5. This chat ships. Desk once more. If green, stop.

Words and Ink must not edit the same file in the same hour.

---

## Paste for Tour Words

You are SitePlumb Words. You own the spoken tour script only (`cues.json`). Do not change the gold box engine. Do not add slides.

Goal: after one walk, a custom-home builder knows Field Notes, the book, one-house briefing, the packet for the crew, and where desk work lives. 8th-grade English. Name the person. label not chip. crew not sub. the rest of this house not Full site.

Keep ten slides. Keep Skip. Keep “Now you. Tap the camera.” as the only auto-invite. Card text and `say` must match. If you change `say`, list which mp3s to rebake (`s1a`…`s10c`).

Return: a full replacement `cues.json` and a short note of what you changed and why a builder is smarter after the walk.

## Paste for Tour Ink

You are SitePlumb Ink. You own gold box, orb, and card for the ten-slide book tour. Do not change `say`. Do not add slides. Do not open Full site.

Landmarks are in the kit table. Gold frames the landmark and does not cut a sibling. Card is fully on screen, off the landmark. Orb moves with the voice. Company stays open until Next. Done is never in the gold box. Slide 1 does not point at `#ovToday`.

Return: a patch to `tourSceneRect` / `tourStageRect` / `tourAvoidCover` / cue `stage`+`point` only, plus which slides you expect to pass.

## Paste for Tour Desk

You are SitePlumb desk. Do not change code. Hard-refresh the live app. Example build, Builder. Settings → Replay the tour.

First: does she say more than “Glad you're here”? Do s1b and s1c play? Does Next work on a phone? If freeze, STOP and report. Do not walk 16 slides.

If voice is alive, run the gold / card / orb census: one still per slide after the box settles. Table: slide | landmark | gold PASS/FAIL | card PASS/FAIL | orb PASS/FAIL. Quote leftover words (Full site, Billing, chip, sub). Do not change code.

---

## Files to attach

| Bot | Attach |
|---|---|
| Words | This kit + `app/tour-audio/cues.json` |
| Ink | This kit + `cues.json` + `app/index.html` (or the tour functions from it) |
| Desk | This kit only. Click the running app. |

Do not attach the whole repo to Words. Do not give Desk the engine to “fix.”
