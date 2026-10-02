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
