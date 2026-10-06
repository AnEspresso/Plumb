# Running SitePlumb against the local Firebase emulators

Use this to walk the invite flow (or anything else) with fake accounts against the real `firestore.rules`, `storage.rules` and Cloud Functions, without touching production.

1. Install once at the repo root: `npm install` (brings `firebase-tools`), and in `functions/`: `npm install`. The Firestore and Storage emulators need Java 11 or newer.
2. Start the emulators from the repo root:
   `npx firebase emulators:start --only auth,firestore,storage,functions --project plumb-467a0`
   Ports come from `firebase.json`: Auth 9099, Firestore 8088, Storage 9199, Functions 5001.
3. Serve the repo root on localhost, for example `python3 -m http.server 8000`.
4. Open `http://localhost:8000/app/?emu=1`. A red EMULATOR badge in the bottom-left corner confirms it. App Check is skipped, and Cloud Function calls go to the local Functions emulator.
5. Create fake accounts by signing up in the app (the Auth emulator accepts any email). Use a second browser profile for the invited person.

The flag sticks for the browser tab. Open `?emu=0` to turn it off. It only works when the page is served from `localhost` or `127.0.0.1`; on siteplumb.com `?emu=1` does nothing. `sim.js` checks that guard on every run.

## F-2 money replay (2.463.0)

`f2replay.js` boots the real `app/index.html` in jsdom and points its own Sync code at the Firestore emulator with the repo's `firestore.rules`. It seeds a house the 2.462.0 way (invoices in `meta.invoices`, money on `sel`), opens it as the homeowner (must write nothing), runs the real migration as a money-gated builder, then replays the crew reads b1–b4 and checks crew get/list of `inv` and `selm` are denied. Money on every screen is compared with the 2.462.0 app.

`F2_PROOF_DIR=../f2-app-proof F2_OLD_INDEX=<2.462.0 index.html> npx firebase emulators:exec --only firestore --project demo-plumb-rules 'node f2replay.js'`

Needs the root `npm install` plus `jsdom` (root or `app/node_modules`). Exit 0 means every check passed. `F2_OLD_INDEX` is optional; without it the truth numbers come from this app.
