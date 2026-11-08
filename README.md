# India's Hidden Gems redesign

A new frontend for https://storied-otter-d8b50e.netlify.app/. It's an Apple-style scrolling page with 3D effects, and it's wired to your existing AI consultant at `/api/chat`.

## Files

| Path | What it is |
|---|---|
| `site/index.html` | The finished page, ready to deploy (generated, don't edit by hand) |
| `site/_redirects` | Netlify rule that proxies `/api/chat` to your existing backend |
| `site/places/*.jpg` | The 9 ring photos, cropped to remove the printed captions |
| `site/bg-video.mp4`, `site/poster.jpg` | Your hero video, plus a poster frame so the hero isn't black while the video loads |
| `src/page.html` | The source you edit |
| `src/admin.html` | The admin page at `/admin`: places, enquiries and saved chats |
| `firestore.rules` | Firebase security rules (database access control) |
| `firebase-config.js` | Your Firebase web app config (public by design) |
| `vendor/`, `fonts/` | Self-hosted libraries and fonts (SIL Open Font License) for the live site, so it never waits on jsDelivr or Google Fonts |
| `deploy_netlify.py` | Publishes `site/` to storied-otter without breaking the AI chat |
| `build.py` | Rebuilds `site/index.html` from `src/page.html` |

## Deploy

**The live site is https://storied-otter-d8b50e.netlify.app/**, and the AI chat works there.

How it's wired:
- The new design's files are served from `/hg/` on that Netlify site.
- `_redirects` maps `/`, `/places/*`, the video and the poster onto `/hg/`.
- Everything else, including the AI chat at `/api/chat`, falls through to the site's original `netlify.toml`. That file passes requests on to your Lovable app, exactly as before.
- The original `netlify.toml` is reused by its fingerprint, so nobody needs to know or re-upload its contents.

**To update the live site:**

```bash
python3 build.py && python3 deploy_netlify.py
```

This needs a Netlify personal access token. In Claude cloud sessions on your Default environment, it's already saved as a network secret. Anywhere else, set `NETLIFY_AUTH_TOKEN`.

**To undo:** in Netlify, go to Site → Deploys, open the May 21 deploy `6a0e7d37…` (your original Lovable version), and click "Publish deploy".

Don't drag `site/` onto storied-otter by hand. That would drop the chat pass-through, and the chat would stop working. Use `deploy_netlify.py` instead. Dropping `site/` on a *different* Netlify site (Netlify Drop) is fine; its `_redirects` forwards the chat to storied-otter.

## Edit

1. Change `src/page.html`.
2. Run `python3 build.py`.
3. Run `python3 deploy_netlify.py` to update the live site.

To point the chat at a different endpoint, set `window.HIDDEN_GEMS_CHAT_API = "https://…/api/chat"` before the main script. The endpoint must allow CORS if it's on another domain.

## What changed from the original

- **Structure.** The site was one fixed screen. It's now seven sections, each with one job: hero, why it exists, places, how it works, when to go, the consultant, and travel well. A sticky nav changes colour to match the section under it and shows scroll progress.
- **3D and motion.** The hero video shrinks and tilts back into a card as you scroll. A live Three.js ridge-line terrain flies under the statement while its words light up. Places is a pinned 3D ring (see round 2 below). A 3D device turns as the "How it works" steps change it. The chat panel swings up from a tilted plane. Smooth scrolling uses Lenis, choreography uses GSAP ScrollTrigger.
- **Chat.** It's the same backend (AI SDK stream protocol), now with Stop, New chat and Try again, and markdown that's sanitised before it renders. Suggestion chips, place cards and calendar months all start a conversation.
- **Fixes.** One `<h1>` instead of two, real meta and Open Graph tags (no more "Lovable App"), a labelled textarea and send button, a skip link, a pause control for the video, `prefers-reduced-motion` support (static layout, video paused) and no horizontal scroll on phones.
- **Libraries** (exact versions from jsDelivr): gsap 3.12.5, lenis 1.1.13, three 0.128.0, marked 12.0.2, dompurify 3.1.6.

## Motion added in round 2 (based on the Theo Nolan Framer template)

I studied that template's motion and wrote my own versions of it for this site. No template code was copied.

- **3D place ring** (Places section). Your India photos sit on a ring tilted in 3D, each with its place name. As the section pins, the camera moves from the whole ring onto its right edge, and each step of scrolling turns the ring one place. A dial on the left edge counts the places, and the panel shows the front place with an "Ask about…" button. Hovering a card turns it to face you, and clicking one brings it to the front. There's an optional click sound per card (off by default).
- **Intro loader.** Place covers orbit a 0 to 100 counter, then vertical blinds open onto the hero. It plays once per browser tab session and is skipped when reduced motion is on.
- **Masked headline.** The hero headline rises out of a mask when the loader lifts.
- **Line-by-line reveals** for section headings and leads.
- **Letter scramble** on nav links, footer links and button labels when you hover them.

## Database and backend (Firebase)

Firebase replaced Supabase. It powers four things:

| Feature | Where it lives | Who can do what (enforced by `firestore.rules`) |
|---|---|---|
| Places in the 3D ring | `places` | Everyone reads published places. Only admins add, edit, hide or delete them. India only, with coordinates inside India. |
| Visitor accounts | Firebase Authentication (email and password, or Google), `users/{uid}` | Each visitor reads and writes only their own profile and saved places. |
| Saved chat history | `chats/{id}` and `chats/{id}/messages` | Visitors get a private anonymous account in the background and see only their own chats. Creating an account (email or Google) keeps them. Admins can read all chats. |
| Trip enquiries | `enquiries` | Anyone can send one (fields and lengths are checked). Only admins can read them or change their status. |

The AI chat itself still runs on the Lovable backend.

**Accounts (Sign in at the top right, or Save on a place):**
- **Create account:** name, email and a password of at least 8 characters. Firebase emails a link to confirm the address; until it's confirmed, the account menu shows a reminder with a resend link.
- **Sign in:** email and password, or Continue with Google.
- **Forgot password?:** sends a reset link by email. The message is the same whether or not the email has an account, so nobody can use the form to check who is registered.
- **Change password:** in the account menu, for email accounts. It emails a reset link.
- A visitor who chatted before creating an account keeps their saved chats: the anonymous account is upgraded, not replaced.
- Reset and confirmation emails come from Firebase. To change their wording or sender name: Authentication → Templates.

**The admin page** is at `https://storied-otter-d8b50e.netlify.app/admin`. Sign in with an email listed in `isAdmin()` in `firestore.rules`, using Google or an email and password (with Forgot password if needed). An email-and-password admin must confirm the address first; the page offers to resend the link. Then you can:
- manage places, including importing the 9 starter places in one click;
- read enquiries and mark them new, contacted or closed;
- read saved chats.

**Files:**
- `firebase-config.js`: your project's web config. It's public by design; the rules are what protect the data.
- `firestore.rules`: the security rules. Paste them into Firebase console → Firestore Database → Rules, then click Publish.
- `src/admin.html`: the admin page.

**If Firebase is ever unreachable:** the page and chat keep working, and the ring uses the same 9 places built into `src/page.html`.

**Firebase setup checklist (one time):**
1. Create the database: Firestore Database → Create database → production mode, region `asia-south1` (Mumbai).
2. Turn on sign-in: Authentication → Sign-in method → enable **Email/Password**, **Google** and **Anonymous**.
3. Allow your site: Authentication → Settings → Authorized domains → add `storied-otter-d8b50e.netlify.app`.
4. Publish the rules: in `firestore.rules`, replace `your-admin-email@example.com` with your admin email address, then go to Firestore Database → Rules → paste the file → Publish.
5. Connect the site: put your web config in `firebase-config.js`, then run `python3 build.py && python3 deploy_netlify.py`.
6. Load the places: open `/admin`, sign in, and click "Import the 9 starter places".

**Testing on your own computer:** add `emulators: {auth: "http://127.0.0.1:9099", firestore: ["127.0.0.1", 8080]}` to the config in `firebase-config.js` and run `firebase emulators:start --only auth,firestore`. The site then talks only to the local emulators. This setting only works on `localhost`, but remove it before deploying.

**Old Supabase data:** the `hidden_gems_places` table in Supabase is no longer used by the site. It's kept as a backup until you ask for it to be deleted.

**Libraries:** Firebase JS SDK 12.19.0 (compat builds, Apache-2.0) is in `vendor/firebase@12.19.0/`.
