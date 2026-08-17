# Pinned: last live walk (2.293.0)

**What this is.** The last walk that toured the *real* demo UI — measure live cards, open Field Notes, close the house sheet, underline pills. Shipped as **2.293.0**. Zip: `/publish/Plumb-2.293.0.zip`. Branch to restore: run that zip or `startTour('team')` from Walkthrough studio → **Old live walk**. **2.294+** left this path on purpose.

**Why we pinned it.** Peter called the live walk a mess after ~20 micro-ships. We stopped patching the gold box on a moving layout and built a locked stage (2.294). This file is how to come back to the live walk without guessing.

---

## What we were planning

A self-advancing **symphony** of four things, in time with Ara (warm baked voice, never the 90s TTS):

1. **Stage (gold box)** — sets the *scene*. Light everything that belongs to the feature being discussed. Not a hairline around one chip.
2. **Orb** — the visual voice. Pulls the eye to the exact thing she is naming, *while* she names it.
3. **Voice** — 34 Ara MP3s (`tour-audio/s1a.mp3` … `s10c.mp3`). One line at a time. No overlap. No robot fallback.
4. **Card** — title + body + Skip/Next. Always in the **least important** band. When the stage resizes, the card reassesses.

Ten slides, demo as the canvas:

| # | Slide | Job |
|---|---|---|
| 1 | Glad you’re here | Coming up. One hello. Skip is safe. |
| 2 | Field Notes | Tap camera → sheet → chip / note / **Send**. |
| 3 | Your book | Needs You · Recent Decisions · A–Z. Underline the words. |
| 4 | The houses | All homes, then a house row. |
| 5 | The briefing | One house. Still open, then the doors. |
| 6 | The doors | Schedule, Selections, Money, Field Notes. Underline each. |
| 7 | The packet | Still open is what the sub sees. Live. |
| 8 | Full site | Close the house first. Then Log / Needs You / Build / Files. |
| 9 | Company | Briefcase, then the office drawer. |
| 10 | You’re set | Back on Coming up. Replay from Settings. |

---

## Rules (do not break these if you resume)

**Stage**
- One job: frame the *feature*, not a pixel. Too small and it nags. Too big and it is the whole phone.
- Named landmarks (`welcome`, `book`, `field`, `sheet`, `houses`, `site`, `company`) — not a raw `#ovCards` that swallows the screen.
- Snap to cards. Never cut through a card halfway.
- Full site: **close the house sheet first**. The job must be in front.

**Orb**
- **Circle** = look at this *area*.
- **Tap / invite** = do this *now* (camera, Send). The user’s tap is the only press.
- **Underline** = read this *label* (pills, door names, tabs). Brass, one pass, then it sits. Never underline the gold box or a photo.
- Moves with the voice. Not after she finishes.

**Voice**
- Unlock on the **same tap** that starts the walk: play `s1a` on the shared `<audio>`.
- The first cue **reuses** that clip. Do not `startAc` while `s1a` is already playing (that was the creepy double hello).
- Later lines: Web Audio if the buffer is ready, else the same element. Never `speechSynthesis` on the team walk.
- If 1.8s pass with no sound: unlock and play `s1a` once more. Symphony start-gate at 2.5s flags **FREEZE** and we fix before talking to Peter.

**Card**
- Least important area. On a phone that is usually the band farther from the ring.
- Never sit on the gold box. If the stage resizes, move.

**Field Notes**
- Tap the camera. Sheet stays. Chip / a few words / Send.
- Do not skip to the next slide after the camera tap.
- `s2d` audio still says “tap the camera” — if you resume the live walk, rebake that line for Send.

**PWA / Safari**
- Home Screen cache can serve a silent old shell. After a ship: hard-refresh; if still dead, delete the Home Screen copy and add it again.
- Service worker must never fall back `index.html` for `*.mp3`.

**What we would not do again**
- Ship another gold-box / orb / freeze patch on this live tour as the *main* walk. That loop is why 2.294 exists.
- Measure live `#ovToday` / `#houseBody` as the only source of truth. The demo reflows; the ring follows the mess.

---

## How to run it again

- **In 2.294+:** Settings → Walkthrough studio → **Old live walk** (`startTour('team')`). Classic even older tour: **Classic walkthrough** (`startTour('teamLegacy')`).
- **Restore the whole app:** install `/publish/Plumb-2.293.0.zip` or check out that ship.
- **Engine:** `node scripts/tour-symphony.mjs` against a build that still calls `startTour('team')` from `startTeamTour`.

Pinned 17 Aug 2026. Owner: Peter. Do not delete this file or the 2.293 zip.
