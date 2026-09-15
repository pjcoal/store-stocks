# store-stocks

Tooling for PJ's idea: source real businesses, pre-stage "unofficial community
tokens" for them on [pons.family](https://www.ponsfamily.com) (the launchpad
on Robinhood Chain), and let the real owner claim the listing later. The
site is branded **Store Stocks**, deployed at
[storestocks.xyz](https://storestocks.xyz).

This is a monorepo: `frontend/` and `backend/` are meant to be deployed
together and stay in sync with each other, so a change to what the site
writes to the database and a change to what the database accepts land in
the same commit. See **Real backend (Firebase Firestore)** and
**Deployment (GitHub + Vercel)** below for how the two halves fit together
and how this repo goes from a `git push` to the live site.

## What's in here

| Path | What it does |
|---|---|
| `frontend/index.html` | The site itself — a single self-contained HTML/CSS/JS file (no build step). This is what's deployed to Vercel at storestocks.xyz. |
| `frontend/assets/logo-128.png` | Source file for the brand mark (the page itself embeds it inline as a data URI, so this is just the editable original). |
| `backend/firestore.rules`, `backend/firestore.indexes.json`, `backend/firebase.json` | The real, shared, persistent data store — Firestore, accessed directly from the frontend's Firebase SDK, with these rules as the only enforcement layer (no server process). See `backend/README.md` for one-time setup and deploying the rules. |
| `lib/ponsFactory.js` | Verified ethers.js client for the real `PonsLaunchFactory` contract. Builds transactions; never signs or sends anything on its own, and hard-blocks a set of "bait" addresses found planted in pons.family's own GitHub repo (see **Security note** below). |
| `lib/pons-factory-abi.json` | The exact ABI slice needed for launching + reading, pulled from the repo and cross-checked against pons.family's published docs. |
| `scripts/source_businesses.py` | Pulls real business candidates from the Google Places API into `data/businesses.json`. Sourcing only — never touches the blockchain. |
| `scripts/launch_token.js` | CLI that launches **one** token at a time, always printing a summary and requiring you to type `yes` before it signs anything. No batch/unattended mode on purpose. |
| `data/sample_businesses.json` | Fictional demo entries (clearly labeled) — no longer loaded into the live site (see **Look and feel** below), but still here if you want fixture data for local testing. |

## Security note — read this first

This section documents a real finding from building this project, kept here
for the record even though the on-page banner that used to surface it was
removed from the live site at PJ's request (the underlying safety check,
`BLOCKED_ADDRESSES`, is unaffected and still hard-blocks these addresses in
every wallet-facing code path — see below).

While pulling the contract ABI and function signatures for this project, I
cloned `ponsdotdev/ponsfamily` (the repo pons.family's own docs point
integrators to) and found several markdown files hidden inside vendored
dependency folders — paths like
`contractsV2/lib/v4-core/src/interfaces/callback/ozz.md` and
`contractsV2/src/v2/hooks/PonstakingV2_test/staking_v1.md` — dressed up as
"secret" content ("the Cult of Pons," an Easter-egg "gate") that each reveal a
raw wallet/token address for something undisclosed (`$PONSTAKE`, `$GATEWAY`,
one unnamed address captioned "don't ape more than you can afford to lose").

That's a recognized bait pattern: plant an address somewhere a curious
reader — or an AI coding agent asked to "integrate with X," which is exactly
what was happening here — will stumble across it and treat it as an insider
tip, driving buys into a token the repo's author controls. There's no proof
of intent either way, but there's no reason to trust it, and it has nothing
to do with the real launch factory.

**None of those addresses appear anywhere in this codebase except inside
`BLOCKED_ADDRESSES` in `lib/ponsFactory.js`, where they're hard-denied.** Do
not add addresses to that file, or anywhere else in this project, that you
found in a README/comment/doc rather than in pons.family's own live app
(ponsfamily.com) or its docs site (docs.ponsfamily.com). If you ever see
either of those hyped to you as "alpha," treat it the same way you'd treat
any other tip to buy a coin from a stranger.

The core factory contract itself checks out: the address
`0xA5aAb3F0c6EeadF30Ef1D3Eb997108E976351feB` matches independently between
pons.family's published docs and the repo's `contract-meta.json`, and the
`launchToken(...)` function this project calls is a straight read of the
Solidity source, not a guess.

### Update — switched to pons.family's "v2" factory

The address above (now referred to as "v1") turned out to have its
on-chain `launchEnabled` flag set to `false`: it only accepts launches from
wallets pons.family has explicitly added to `whitelistedLaunchers`, which
is why launches from this site were reverting with a custom error
(`NotWhitelisted()`) that ethers could only report as an opaque
`0x584a7938` until the ABI here was updated to decode it.

pons.family's own live launchpad UI (ponsfamily.com/launchpad/create) has a
"v1"/"v2" toggle. Its "v2" option targets a different factory —
`0xF4fC0CD27fC8EcF17E55eE4c3f7201897dF3eb75`, an EIP-1967 proxy to a
verified `PonsLaunchFactory` implementation. Same trust rule as above: this
address was found in pons.family's own live production JS bundle (paired
there with its matching locker contract), not in a doc/README/comment, and
was then independently confirmed on-chain before being used here —
verified contract source, `launchEnabled() == true`, an enabled DEX config
and launch config, a matching `launchFee()`, and the identical
`launchToken(...)` signature as v1. `frontend/index.html`'s
`FACTORY_ADDRESS` and `lib/ponsFactory.js`'s
`PONS_LAUNCH_FACTORY_ADDRESS` now both point at v2; the v1 address is kept
around as `PONS_LAUNCH_FACTORY_ADDRESS_V1_LEGACY` for reference only.

### Update — website link, token image, and a 3% creator tax to a fixed wallet

Three things were requested together: link every launch to
storestocks.xyz on-chain, let launchers add a token image, and route a 3%
creator tax on every launch to one fixed wallet. All three were verified
directly against contract source fetched live from Blockscout (not the
vendored GitHub repo — same trust rule as above) before writing any code.

**The first pass got the factory wrong, and here's exactly how.** The
address this project had been calling pons.family's "v2" factory
(`0xF4fC0CD27fC8EcF17E55eE4c3f7201897dF3eb75`) turned out to be a second,
*open* deployment of the same old Uniswap-V3-LP-seeding `PonsLaunchFactory`
contract as the "v1-legacy" address above it — not the bonding-curve
system pons.family's own live launchpad UI actually uses under its "v2"
tab. Both addresses are real, verified, on-chain contracts; being
independently verifiable is what made the wrong one *look* trustworthy.
The tell was in the UI itself: pons.family's live "v2" launch form has an
"Advanced" section with a settable "Creator tax %" field ("Traders pay
1.00% in total, up to 10% of it yours") — a feature the old contract type
has no equivalent of at all. That mismatch is what prompted re-deriving
the address from scratch, this time from the strongest form of this
project's own trust rule: not a JS-bundle text scrape, but the *actual
eth_call network traffic* pons.family's own page made while genuinely
loaded in a browser, decoded byte-for-byte (Multicall3 payload → per-call
`to` address → function selectors matched against `launchFee()`,
`launchEnabled()`, `canLaunch(address)`, `maxCreatorTaxBps()`,
`getLaunchConfig(uint256)`, all confirmed by hash). That address —
`0x7eD598BcEf8bd9Edd8C97A195C6d13f40801EC7e` — is a verified
`PonsV2LaunchFactory` contract, confirmed independently on-chain
(`launchEnabled() == true`, `canLaunch()` true for an arbitrary unrelated
address, live `launchFee`/`launchConfig`/`maxCreatorTaxBps` state matching
what the UI showed). `frontend/index.html`'s `FACTORY_ADDRESS` and
`lib/ponsFactory.js`'s `PONS_LAUNCH_FACTORY_ADDRESS` now point at this
address; the old "open v1-type" address is kept as
`PONS_LAUNCH_FACTORY_ADDRESS_V1_OPEN_MISLABELED_V2` for reference, and the
whitelist-gated original as `PONS_LAUNCH_FACTORY_ADDRESS_V1_LEGACY`.
**Lesson for future work on this file: on-chain verifiability proves a
contract is real, not that it's the one a given UI flow actually calls —
that needs the actual call traffic, or the UI's own decoded ABI, not just
an address found in a bundle.**

This factory is a genuinely different system, not just a config change:
tokens trade on a per-launch bonding curve (`PonsV2BondingCurve`) until a
graduation threshold is raised (currently 4.2 ETH for the ETH-paired
config), then migrate into a Uniswap V4 pool — rather than seeding a
Uniswap V3 pool immediately the way the old contract did. Its `TokenParams`
struct is shaped differently too (`creatorFeeRecipient` + `creatorTaxBps`
instead of `feeWallet`; `pairToken` is a plain address — `address(0)` for
native ETH — passed alongside `TokenParams`, not chosen via a separate
`dexId`).

With that corrected, the three asks:

1. **Website link works for real here.** `PonsV2LauncherToken`'s
   constructor stores `_socials` exactly as given (`_socials = socials_;`,
   no wiping) — confirmed against its source, unlike the old contract this
   project first pointed at. Every launch sets `socials.website` to
   `https://www.storestocks.xyz/` directly, and still appends it to
   `description` too, since some UIs surface description more prominently
   than the website field.
2. **Token image** feeds `TokenParams.logo`, which this contract also
   stores as given. Same as before: a "Token image" URL field on the
   launch form, and a prompt on the quick-launch action, both feeding
   `logo`. Still a URL field, not a file upload — `logo` is a `string` in
   contract storage, so every character costs real gas; `validateLogoUrl()`
   in `frontend/index.html` requires `https://` and caps it at 500 chars.
3. **A real, settable 3% creator tax.** This contract genuinely supports
   it: `creatorTaxBps` is an *additional* trade-fee cut on top of the
   pool's own base fee (`curveFeeBps`, currently 100 bps = 1.00% for the
   active launch config), capped by the live `maxCreatorTaxBps()`
   (currently 1000 bps = 10%) and by
   `curveFeeBps + creatorTaxBps <= MAX_TOTAL_TRADE_FEE_BPS` (2000 bps =
   20%). Every launch from this site now sets `creatorTaxBps = 300` (3%,
   read live against both ceilings before assuming it still fits — either
   can change) and `creatorFeeRecipient` to a fixed Store Stocks wallet
   (`0xb12b856fbE3A72aE6794b6e83bf8122FBD00D5eB`, checked against
   `BLOCKED_ADDRESSES` like any other address). Both are set directly in
   `TokenParams` and take effect the moment `launchToken()` confirms — no
   follow-up transaction needed. From then on that wallet, not whoever
   signs the launch, receives the full 3% creator cut of every trade on
   that token (on top of pons.family's own 1% base fee, which this site
   doesn't touch).

   **This is a deliberate custodial design, confirmed with the site
   owner.** The "claim your fees" flow documented below was originally
   built around fees belonging to whoever launched the token, reassignable
   to the real business owner via pons.family's process once claimed.
   Routing every launch's creator tax to a fixed platform wallet instead
   means this site now holds that revenue in escrow rather than it
   belonging to the launcher by default — by design, per the site owner:
   held by Store Stocks until a business claims its listing, at which
   point it's on Store Stocks to move the wallet's share over (this
   factory's `transferCreatorFeeRecipient`/`setCreatorFeeRecipient`, both
   timelocked, can do that). That's a real custodial-funds relationship
   with third parties, closer to the pattern the section below already
   says to get legal advice on (UK FCA custodial-payments / safeguarding
   territory) than the original non-custodial design was. This README
   flags it; it doesn't resolve it — get an actual lawyer's read before
   this runs at any real volume, same as the existing advice below already
   says for the business-listing side of things.

### Update — token image actually displays on-site, a fixed X link on every token, and why Google Maps auto-fill can't pull photos/website

Three follow-on asks after the update above:

1. **The token image wasn't showing up anywhere on the site itself.** The
   prior update fed the image URL into `TokenParams.logo` on-chain (so
   wallets/explorers that read that field would show it), but nothing in
   `frontend/index.html` ever read it back — every avatar on the site
   (listing rows, the drawer, the launch log, the portfolio tab) always
   rendered the generated initial-letter placeholder, never an uploaded
   image, launched or not. Fixed by: storing the validated image URL on the
   `launches/{id}` record as `logoUrl` (the `businesses/{id}` doc can't
   carry it — it's create-only, see `backend/firestore.rules`, and an
   already-listed business's doc can't be retrofitted after the fact — but
   a fresh `launches/{id}` doc is always written at launch time either
   way); and a new `avatarHtml()` helper, used at every one of the site's
   avatar-rendering spots, that renders an `<img>` when a launch has a
   `logoUrl` and falls back to the same colored-initial placeholder
   otherwise (with an `onerror` handler so a dead image link degrades to
   the placeholder instead of a broken-image icon). `backend/firestore.rules`
   `isValidLaunch()` was updated to allow this new `logoUrl` field
   (nullable string, `https://` + 500-char cap, mirroring
   `validateLogoUrl()` client-side) — **this rules file needs a manual
   redeploy via the Firebase console for the new field to actually be
   accepted**, same as the still-pending `lat`/`lng` rules change from
   earlier. Also added a live preview (image thumbnail + ok/warn hint)
   right under the "Token image" field on the launch form, so a launcher
   sees before they ever sign a transaction whether their link is going to
   render.
2. **A fixed X (Twitter) link on every token.** `socials.twitter` is now
   set to `https://x.com/StoreStocksRH` on every launch from this site
   (`PROJECT_X_URL` in `frontend/index.html`), the same way `socials.website`
   already gets set to storestocks.xyz. Unlike the website field, there was
   never a contract-level obstacle here — `PonsV2LauncherToken` stores the
   whole `Socials` struct as given (see above) — it simply hadn't been
   wired up yet.
3. **Auto-filling "business links" (photos/website) from a pasted Google
   Maps link — not done, and likely not possible without a real API
   integration.** `parseGoogleMapsUrl()` only reads what's already sitting
   in the URL's own text: a `/place/<name>/@lat,lng` segment and an opaque
   place-ID token. A Google Maps *place* URL does not embed a website URL
   or photo URLs anywhere in its text — those only exist server-side,
   behind Google's Places API (Place Details for the website, Place Photos
   for images), which this site does not call, on purpose: every existing
   "prefill" hint on the launch form says outright "pulled straight from
   the link text — no outside request was made," which is a real,
   deliberate design choice (no API key to manage/pay for, no third-party
   request made with a visitor's data). Actually fulfilling this request
   would mean adding a genuine Google Places API integration — a paid,
   keyed, server-side (or at least API-key-in-the-client) dependency this
   site doesn't have today, and a real reversal of that "no outside
   request" design. That's a decision for the site owner, not something to
   guess at silently; it hasn't been built, and needs an explicit go/no-go
   (and, if yes, an API key and a decision on where that key lives, since a
   Places key embedded in this static frontend is visible to anyone) before
   it should be.

### Update — direct PNG upload for the token image

The launch form's "Token image" field now offers a real file picker
("Upload a PNG") right above the existing "paste a URL" field — pick a PNG
from your computer and it uploads to Cloud Storage for Firebase, then fills
the URL field with the resulting link automatically (so the existing
preview, validation, and on-chain `logo`/`launches/{id}.logoUrl` wiring all
just work unchanged — see `uploadLogoPng()` in `frontend/index.html`).
Capped at 2MB per file, PNG only (enforced both client-side and by
`backend/storage.rules`); paste-a-URL is still there for anyone who'd
rather host the image elsewhere, or for other file formats.

**This needs a one-time setup step you haven't done yet, and it costs
real money to turn on (usually $0/month at this site's scale, but a real
card on file).** Cloud Storage for Firebase now requires the paid Blaze
plan even for light use — see `backend/README.md`'s new "Cloud Storage"
section for exactly what to click and why. Until that's done, the upload
button hides itself automatically (`updateLogoUploadAvailability()`) and
the URL field keeps working exactly as before — nothing breaks, the new
option just won't appear yet.

## Setup

```bash
npm install
pip install requests --break-system-packages   # or use a venv
```

You'll need:
- A wallet with ETH bridged to Robinhood Chain (chain ID 4663), for the launch
  fee (currently ~0.0005 ETH per launch) plus gas.
- A Google Places API key (`GOOGLE_PLACES_API_KEY`) if you want to source real
  businesses rather than use the fictional demo data.

## Sourcing real businesses

```bash
export GOOGLE_PLACES_API_KEY=your_key_here
python3 scripts/source_businesses.py --query "coffee shop" --location "New York, NY" --out data/businesses.json
```

This only writes a JSON file. Nothing is published or launched yet.

## Launching one token (manual, per-business)

```bash
export PONS_LAUNCHER_PK=0xyour_burner_wallet_private_key
node scripts/launch_token.js --file data/businesses.json --id places-abc123
```

The script prints the token name/symbol/description/fee wallet and the exact
launch fee, then waits for you to type `yes`. It will not send anything
without that.

**Use a fresh burner wallet for this**, not your main one — fund it with just
enough ETH for launches, nothing more.

## Before you launch anything real

This is the part that matters more than the code. Creating a coin using a
real business's name and logo, before they've agreed to anything, sits close
to a few real lines:

1. **Say "unofficial" loudly.** Every listing's description and any social
   copy needs to say clearly it is not created by, endorsed by, or affiliated
   with the business, until the real owner has claimed it. `source_businesses.py`
   bakes this into the generated description by default — don't strip it out.
2. **Don't imply the token is a stake in the business.** No revenue share, no
   "invest in this shop" language. That's the line between a meme/collectible
   and something that looks like an unregistered security.
3. **Have a fast opt-out.** If a business owner asks you to take their name
   down, do it quickly. Keep a `removed`/`delisted` status in the data model
   for this (not yet wired into the sample schema — add it before going live).
4. **UK financial promotion rules apply to you.** The FCA's cryptoasset
   financial promotion regime (from PS23/6, with a fuller authorization
   regime phasing in through 2027) restricts who can promote cryptoassets to
   UK consumers and requires risk warnings. If you're marketing these tokens
   to anyone in the UK, read that regime before scaling past a personal demo.
5. **This is not legal advice.** Get an actual read from a lawyer on
   trademark/passing-off and financial-promotion exposure before running this
   at any real volume — the above is a checklist to bring to them, not a
   substitute for them.

## How "claim your fees via email" actually works

The site's claim flow is email-first — no wallet needed just to *start* a
claim. But it's worth being precise about what "claim the fees" involves,
because the easy-sounding version and the actual mechanics diverge:

1. **Email verifies identity, not payout.** A business owner enters their
   email (ideally on the business's own domain — the site does a cheap
   domain-match check against the listing's website, shown as a weak signal,
   never treated as real verification) and a note. That request lands in the
   **claim queue** at the bottom of the site.
2. **A human reviews it.** This page does not send a real verification
   email — there's no backend behind it, so nothing is actually sent. It's
   honest about that in the UI. When you (or whoever runs the directory)
   confirm the person genuinely runs the business, you click "Mark claimed."
   If you want a real automated flow — a verification code that actually
   emails out — that needs a small backend (Node/Express + a transactional
   email provider like Postmark or Resend, using your own API key) that
   isn't built here; the client-side site has nowhere to safely put an email
   API key. Ask if you want that scaffolded.
3. **Payout still needs a wallet.** Once marked claimed, the site asks for a
   payout wallet address. This is the part that can't be skipped: pons.family
   fees accrue on-chain, in ETH/tokens, in the token's locked liquidity
   position — there is no "send it to my email" option on their end. The
   wallet you save here is what gets pointed at via pons.family's own
   **Community Takeover (CTO)** process (a request reviewed by the Pons team
   that reassigns a token's creator fee payout to a new wallet, without
   touching the token contract or liquidity). This site links to that
   process; it doesn't (and can't) execute the reassignment itself.

**The custodial trap to avoid:** it's tempting to make this friendlier by
having *your* wallet collect all the fees, then pay claimants out yourself —
by bank transfer, say, so a shop owner never has to touch crypto. Don't do
that without thinking it through first. The moment you hold and disburse
other people's money based on nothing but an email claim, you're operating
something close to a custodial payments business, which in the UK means
FCA registration, AML/KYC obligations, and safeguarding requirements — a
real regulatory undertaking, not a feature flag. The wallet-per-claimant
model above keeps this project non-custodial: funds move directly from
pons.family to the business owner's own wallet, and this site never holds
anyone's money. Get a lawyer's opinion before changing that.

## Look and feel

The site was restyled to a dark, map-first layout (sticky nav, hero, an
inline abstract street map with pins for each listing, and a data table for
listings/claims) inspired by the general genre of crypto launch directories —
its copy, icons, logo, and demo business names are all original, and no real
market data (price/market cap) is fabricated anywhere on the page. The map
pins open a card with only the real fields the site actually has: category,
status, launch fee, claim state.

The four fictional demo businesses (Example Coffee Roasters and friends) have
been removed from the live site at PJ's request — `DEMO_BUSINESSES` in the
page's script is now an empty array, so the map starts as a plain street
view with no pins and the listings table starts empty, ready for real
listings added via the "Launch a token" panel or the register-launch flow.
The fictional fixture data still lives in `data/sample_businesses.json` if
you want it for local testing later.

The footer disclaimer line ("Not affiliated with pons.family or Robinhood.
Not financial or legal advice.") has also been removed from the page at
PJ's request. Worth knowing before this gets used with real businesses: that
line was doing double duty as (a) a trademark/passing-off safeguard — a
visible statement that a listing isn't created by or endorsed by the
business — and (b) a rough stab at the risk-warning UK financial promotion
rules expect when cryptoassets are marketed to UK consumers (see **Before
you launch anything real** above). Removing it from the footer is fine for
a private/demo build; before pointing real people at real business tokens,
it's worth putting some form of that disclosure back somewhere on the page
— it doesn't have to be the same wording or the same spot.

## Interface (frontend refresh)

The site went through a frontend-only refinement pass — same dark/green
identity and map concept, tightened up against a formal UI art-direction
framework (hierarchy, spacing, componentry, states, motion) rather than
redesigned from scratch. No backend or data-model changes came with this
pass; it's purely the client-side page (`frontend/index.html`).

**Design tokens.** The existing color tokens (three `:root` blocks — light,
`prefers-color-scheme: dark`, and an explicit `[data-theme="dark"]`
override) were joined by a real spacing scale (`--space-1` through
`--space-7`, 4px base), two shadow levels (`--shadow-md`, `--shadow-lg`,
theme-aware), a small radius scale (`--radius-sm`, `--radius-lg`), and
motion tokens (`--ease`, `--dur-fast`, `--dur`). New components use these
tokens consistently; most pre-existing CSS was left as literal pixel values
rather than mechanically retrofitted, to keep the change low-risk.

**Navigation.** The nav had a duplicate "Claim" link pointing at the same
anchor as "Listings" — removed. Two links now point at the two new sections
below: **Portfolio** and **Admin** (renamed from "Queue," same `#queue`
anchor so nothing else breaks).

**Launch-a-token flow.** The Maps-link panel is now visually split into
"Step 1" (paste the link, prefill) and "Step 2" (review details, launch),
with numbered badges, so the two-stage nature of the flow — parse, then
confirm before sending a transaction — reads as a sequence instead of one
undifferentiated form.

**Listings table.** Each row now shows a colored initial-letter avatar (a
deterministic color per business name — no real logos involved) next to the
name, and a third row action, **View**, alongside the existing Claim and
Launch buttons. View opens a new slide-in detail panel (see next).

**Business detail drawer.** A new slide-in panel (from the right; full-width
on narrow screens) opens from any "View" button. It shows the business's
identity, its token info if launched (or a clear "not launched yet" state),
its claim status, and a description, with actions to manage its claim or
open it on Google Maps.

**Portfolio (new section, `#portfolio`).** Prompts to connect a wallet if
none is connected; once connected, it filters the existing listings/launches
data (no new backend calls) into "tokens you launched" and "listings whose
payout wallet is set to your address," each with a View action into the
drawer. The wallet button in the nav and hero now scrolls straight to this
section if already connected, rather than only ever prompting a fresh
connection.

**Admin review (`#queue`, renamed "Admin review").** Now tabbed: **Pending
claims** (the original claim queue, unchanged in substance) and a new
**Launch log** — a most-recent-first list of every launch on the site,
reusing the same list styling as Portfolio. The claim queue also gained a
**Dismiss** action next to "Mark claimed," for claims that turn out to be
spam or mistaken; dismissing writes a `status: "dismissed"` update (soft
delete, not an actual document delete) and the UI treats `"dismissed"`
identically to "no claim yet" everywhere claim status is shown or filtered,
while still keeping the record for history.

## How tokens end up on the site

Every listing row's "Launch" button writes the launch straight into the
shared directory the moment the transaction confirms — so anything launched
through this site shows up automatically. For a token launched a different
way (pons.family's own UI, or `scripts/launch_token.js`, which has no access
to the site's shared storage), paste the transaction hash into the
**"Register launch"** box: the site fetches the real transaction receipt
from Robinhood Chain, checks it actually called the verified factory
contract, decodes the deployed token address from the `TokenLaunched` event,
and only then records it — so a listing can't be faked by typing in a random
hash.

## Launching a new business from a Google Maps link

The **"Launch a token for a business"** section (also reachable via the
"Launch a token" shortcut on the map) is the main way someone adds a
business that isn't already on the site. They paste that business's Google
Maps link and click "Prefill from link," which fills in the business name,
an approximate — stylized, not GPS-accurate — spot on the map, and a starter
description.

**This only reads the pasted URL's own text — it never calls Google.** The
published artifact runs in a sandbox that blocks outbound requests to
arbitrary hosts, so there's no way for client-side code here to hit the
Google Maps/Places API even if it wanted to (and doing so client-side would
also mean exposing an API key in the page source, which is its own bad
idea). Concretely, the parser pulls three things straight out of a full
`.../maps/place/<name>/@<lat>,<lng>,<zoom>z/...` URL when they're present:
the place name, the coordinates, and (if there's a `data=` segment) Google's
internal place reference, which is stored and used only to flag likely
duplicate listings. It does **not** get opening hours, phone number,
photos, or a verified address — those need the real Places API (that's what
`scripts/source_businesses.py` uses server-side, with your own API key).
Shortened links (`maps.app.goo.gl/...`) can't be expanded here for the same
sandboxing reason — the UI tells the user to open the short link in a
browser tab first and paste the full address-bar URL instead.

Every field the parser fills in is editable before launching, and the
"Launch" button on this panel goes through the exact same on-chain path as
the per-listing Launch buttons (same factory contract call, same
`BLOCKED_ADDRESSES` guard on the fee wallet, same automatic write to shared
storage on confirmation) — the Maps link just removes the busywork of
typing the name, an approximate location, and a first-draft description by
hand.

Every token launched through this project also carries a plain-text tag in
its on-chain description ("launched via Store Stocks") — that's what
lets anyone looking at the token directly on pons.family (not just visitors
to this site) tell it's part of this project, independent of whether this
site's own link is public.

## Real backend (Firebase Firestore)

The site needs somewhere to durably store businesses, launches, and claims
so that data is shared across every visitor rather than reset every time
someone reloads the page. That storage is Firestore — not a custom server:
`frontend/index.html` talks to it directly through the Firebase client SDK,
and `backend/firestore.rules` is the only thing standing between the open
internet and that database.

This shape was chosen specifically for "little-to-no budget, and the
frontend and backend have to actually agree with each other": Firebase's
free Spark plan costs nothing and needs no credit card at this project's
scale, and the code already spoke in a Firestore-shaped way even before
Firestore was wired up — `db.doc(id).set(...)`, `.update(...)`,
`db.collection(name).onSnapshot(...)` — because that's the same shape
Cowork's own Artifact-preview storage happened to use. So
`frontend/index.html` actually supports **two** interchangeable backends,
picked automatically at load time:

1. `window.claude.use("db")`, when the page happens to be viewed inside a
   Cowork Artifact preview.
2. Real Firebase Firestore (`firebaseConfig` near the top of the script),
   when deployed standalone — i.e. at storestocks.xyz.

If neither is available (or the config in `firebaseConfig` is still the
placeholder `REPLACE_WITH_...` values), the site doesn't break — it just
falls back to local, per-visitor state, exactly like it did before this
backend existed.

**Setup:** see `backend/README.md` for the one-time steps (create a
Firebase project, paste its web config into `frontend/index.html`, deploy
`backend/firestore.rules`).

**Security model:** there is no login system anywhere in this project, so
the rules can only validate document *shape* (right fields, right types,
legal status transitions) — the same trust model the site always had,
just now backed by a real, durable, publicly-reachable database instead of
Claude's own private Artifact storage. `backend/README.md` has the details
and the honest limitation this implies.

## Deployment (GitHub + Vercel)

The whole monorepo — `frontend/`, `backend/`, and the operator tooling — is
pushed together to a single GitHub repo, and Vercel deploys `frontend/` as
a static site (its "Root Directory" project setting points at `frontend/`,
so no build step or `vercel.json` is needed) at storestocks.xyz. Pushing
frontend and backend changes in the same commit is the point of the
monorepo: a change to what the site writes and a change to what the
database will accept can never drift apart, because they're reviewed and
deployed together.

Deploying `frontend/` does not deploy `backend/firestore.rules` — Firestore
rules are deployed separately via the Firebase CLI (`backend/README.md`),
since Vercel only serves static/frontend files. When both are in sync
(same repo, same commit) is exactly when the rules match what the deployed
site is actually trying to write.

## Not built yet (roadmap if you want to keep going)

- Real automated email verification (a small backend + email API — see
  **How "claim your fees via email" actually works** above).
- Automated `removed`/`delisted` status + a takedown request form.
- Wiring the CTO submission itself (currently: the site links out to Pons's
  CTO form and tells the claimer what to put in it).
- Real admin authentication (Firebase Auth, gating "mark claimed" /
  "dismiss" to a specific wallet or account) — see **Security model** above.
