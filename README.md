# India's Hidden Gems redesign

A new frontend for https://storied-otter-d8b50e.netlify.app/. It's an Apple-style scrolling page with 3D effects, and it's wired to your existing AI consultant at `/api/chat`.

## Files

| Path | What it is |
|---|---|
| `site/index.html` | The finished page, ready to deploy (generated, don't edit by hand) |
| `site/_redirects` | Netlify rule that proxies `/api/chat` to your existing backend |
| `site/places/*.jpg` | The 9 ring photos, cropped to remove the printed captions |
| `site/bg-video.mp4`, `site/poster.jpg` | Your hero video, plus a poster frame so the hero isn't black while the video loads |
| `site/admin/` | The React admin dashboard at `/admin` (generated from `admin/`) |
| `src/page.html` | The source you edit |
| `server/` | The Node.js + Express backend: accounts, visitors, questions, saved places, enquiries |
| `server/schema.sql` | The database tables (already created in Supabase, schema `hg`) |
| `admin/` | The React source of the admin dashboard (Vite) |
| `vendor/`, `fonts/` | Self-hosted libraries and fonts (SIL Open Font License) for the live site, so it never waits on jsDelivr or Google Fonts |
| `deploy_netlify.py` | Publishes `site/` and the backend to storied-otter without breaking the AI chat |
| `build.py` | Builds everything: `site/index.html` from `src/page.html`, the dashboard, and the backend bundle |

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

1. Change `src/page.html` (the site), `admin/src/` (the dashboard) or `server/src/` (the backend).
2. Run `python3 build.py` (needs Node.js 18 or newer).
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

## Backend, database and admin dashboard

Your own **Node.js + Express** backend replaced Firebase. It runs on the same Netlify site as a serverless function, answering at `/api/v1/*`, and keeps everything in a private **Supabase Postgres** database (schema `hg`, not reachable with Supabase's public keys). The AI chat itself still runs on the Lovable backend.

**What it records:**

| What | Where | Notes |
|---|---|---|
| Accounts | `hg.users`, `hg.sessions` | Name, email, sign-up date, last sign-in, whether the email is confirmed. Passwords are stored only as scrypt hashes. Sign-in uses an HttpOnly cookie. |
| Visitors and visits | `hg.visitors`, `hg.visits` | One anonymous id per browser (cookie). Each visit: time, country / region / city (from Netlify, never exact location, no IP stored), device, browser, system, language, where they came from. Reloads within 30 minutes count as one visit. Bots are marked and left out of the numbers. |
| What they ask (their searches) | `hg.chats`, `hg.chat_messages` | Every question to the AI consultant with its answer. Visitors can reopen their own chats ("Your chats"). |
| Places viewed and saved | `hg.place_events`, `hg.saved_places` | A view counts once a place stays in front of the 3D ring for 1.5 seconds. Saves need an account. |
| Trip enquiries | `hg.enquiries` | From the form at the bottom of the site. The first admin gets an email for each new one. |

**Accounts on the site** (the window opens after the loading animation; also Sign in at the top right, or Save on a place):
- **After loading:** visitors who aren't signed in see the window once per visit: Create account on a new device, Sign in on one that has signed in before. "Continue without an account" closes it, so the site and AI chat stay open to everyone.
- **Create account:** name, email and a password of at least 8 characters. A confirmation link is emailed; until it's used, the account menu shows a reminder with a resend link.
- **Sign in** with email and password. Ten wrong tries in 15 minutes pause that email for a while.
- **Forgot password?** emails a link (valid one hour) that opens the site on "Choose a new password". The answer is the same whether or not the email has an account. Choosing a new password signs out every other device.
- **Change password** in the account menu emails the same kind of link.
- Chats from before signing up stay with the new account.

**The admin dashboard** is at `https://storied-otter-d8b50e.netlify.app/admin` (React). Sign in with an account whose email is in `ADMIN_EMAILS` and has been confirmed. It shows:
- **Overview:** visitors, visits in the last 24 hours, accounts, questions, saved places, new enquiries, visits per day, countries, devices, latest questions and most viewed places.
- **Visitors:** every browser, with location and device; open one to see each visit, every question with its answer, and every place viewed or saved.
- **Accounts**, **Questions** (searchable, with answers), **Places** and **Enquiries** (mark new, contacted or closed).

**Settings (Netlify → Site configuration → Environment variables):**

| Variable | What to put | Needed for |
|---|---|---|
| `DATABASE_URL` | Supabase → your project → Connect → **Transaction pooler** → URI, with your database password filled in (Supabase → Database settings → reset it if you don't know it) | Everything |
| `ADMIN_EMAILS` | Your email (several: separate with commas) | The admin dashboard |
| `BREVO_API_KEY` | Brevo → SMTP & API → API keys → create a key | Password reset, email confirmation, enquiry alerts |
| `MAIL_FROM` | A sender address verified in Brevo (Senders, domains & dedicated IPs). Optional: defaults to the first `ADMIN_EMAILS` address | Emails |

Mark `DATABASE_URL` and `BREVO_API_KEY` as secret. After adding or changing variables, deploy again (`python3 deploy_netlify.py`) so the backend picks them up. Until `DATABASE_URL` is set, the site still shows the sign-in window after loading, but it answers "Accounts are almost ready", and the enquiry form stays hidden.

**If the backend is ever unreachable:** the page and AI chat keep working without accounts, saving or the enquiry form.

**Run it on your computer:**

```bash
cd server && npm install
```

```bash
DATABASE_URL=postgres://… ADMIN_EMAILS=you@example.com COOKIE_SECURE=off npm run dev
```

Then open http://localhost:8787 (and http://localhost:8787/admin). For a local Postgres, also set `DATABASE_SSL=off`; set `MAIL_LOG=mail.log` to write emails to a file instead of sending them. `server/schema.sql` creates the tables.

**Old data:** Firebase is no longer used (you can delete the `projectkala` Firebase project if you like). The old `hidden_gems_places` table in Supabase isn't used by the site either; it's kept as a backup until you ask for it to be deleted.

**Libraries:** backend: express 4.22.3, pg 8.23.1, serverless-http 3.2.0 (bundled with esbuild 0.28.2). Dashboard: react 19.3.1 and react-dom 19.3.1 (built with vite 8.3.6).
