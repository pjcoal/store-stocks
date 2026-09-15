# backend

This is Firestore-as-backend: no server process, just a database and a set
of security rules (`firestore.rules`) that the frontend's Firestore client
SDK talks to directly. See the root README's **Interface (frontend refresh)**
and **Real backend (Firebase Firestore)** sections for the full picture of
why this shape was chosen.

## One-time setup

1. Create a Firebase project at https://console.firebase.google.com (free
   Spark plan — no credit card required) and enable **Firestore Database**
   in **Native mode**, in production mode (the rules here replace the
   default "test mode" rules).
2. In that project's **Project settings > General > Your apps**, add a
   **Web app** and copy the resulting config object.
3. Paste those values into `firebaseConfig` near the top of
   `frontend/index.html` (search for `REPLACE_WITH`). This config is a
   public client identifier, not a secret — it's meant to be committed;
   access is controlled entirely by `firestore.rules`, not by hiding this.
4. Deploy the rules and indexes in this folder:
   ```bash
   npm install -g firebase-tools   # one-time
   firebase login
   cd backend
   firebase use --add               # pick the project you just created
   firebase deploy --only firestore:rules,firestore:indexes
   ```

That's it — there's no build step and nothing else to run continuously.
`frontend/index.html` will start reading/writing real, shared data as soon
as both the config (step 3) and the rules (step 4) are in place; until then
it silently falls back to local, per-visitor state, so the site never
breaks while you're setting this up.

## Cloud Storage (direct PNG upload on the launch form)

The "Token image" field on the launch form can upload a PNG straight from
the visitor's computer instead of requiring a URL — that goes through
Cloud Storage for Firebase, not Firestore, so it needs its own one-time
setup:

1. **This needs the Blaze (pay-as-you-go) plan, not Spark.** As of Google's
   September 2024 change, Cloud Storage for Firebase no longer works at all
   on the free Spark plan — you'll need to add a billing account (a card on
   file) in the Firebase console to even open the Storage tab. Real-world
   cost for this feature should still land at or near $0/month for a small
   site: a 2MB-per-file cap is enforced by `storage.rules` below, and
   typical usage stays inside Google Cloud Storage's "Always Free" monthly
   tier for buckets in `us-central1`/`us-east1`/`us-west1` — but it's a real
   billing account attached to a real card, so keep an eye on it, and know
   this before turning the feature on. If you'd rather not do this, the
   "paste a URL" field keeps working with zero setup either way — the file
   input hides itself automatically when Storage isn't configured (see
   `updateLogoUploadAvailability()` in `frontend/index.html`).
2. In the Firebase console, open **Build > Storage** and click **Get
   started** to create the project's default bucket (this is what prompts
   the Blaze upgrade if you haven't already).
3. Deploy the storage rules in this folder:
   ```bash
   cd backend
   firebase deploy --only storage
   ```
   (`firebase.json` in this folder already points at `storage.rules`.)
4. That's it — no config values to copy. `frontend/index.html` reads the
   bucket name from the same `firebaseConfig.storageBucket` already set for
   Firestore.

`storage.rules` caps uploads at 2MB and requires `contentType ==
'image/png'`, but — same limitation as `firestore.rules` below — it can't
check *who* is uploading, only *what*. That's an acceptable trust
trade-off for a small community site, not a mistake; revisit it if this
gets real traffic.

## Changing the data model

If a field is added to a `businesses`/`launches`/`claims` document in
`frontend/index.html`, update the matching `isValid*` helper in
`firestore.rules` (and its `hasOnly([...])` field list) in the same change,
then `firebase deploy --only firestore:rules`. Firestore rejects writes
whose shape the rules don't recognize, so the two files drift out of sync
loudly (writes start failing) rather than quietly.

## Known limitation: no admin auth yet

There's no login system anywhere in this project yet, so `firestore.rules`
can validate *shape* (right fields, right types, legal status transitions)
but can't restrict *who* claims a business, marks a claim reviewed, or
dismisses one — anyone with the site open (or just the Firebase web config,
which is public by design) can call those same writes directly. This is the
same trust model the site already had before this backend existed; it's
tracked as a roadmap item in the root README, not a regression introduced
here.
