# Moodblendy

Moodblendy is a reference-driven AI moodboard app. The current model is sources -> elements -> composition: full source images live in a side rail, extracted transparent cutout elements populate the tldraw board, and generation composes from those elements plus swatches, type samples, notes, and the brief.

## Required environment variables

```bash
FAL_KEY=
GOOGLE_FONTS_API_KEY=
NEXT_PUBLIC_APP_URL=https://moodblendy.com
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
NEXT_PUBLIC_TLDRAW_LICENSE_KEY=
NEXT_PUBLIC_POSTHOG_KEY=
NEXT_PUBLIC_POSTHOG_HOST=https://us.i.posthog.com
POSTHOG_SERVER_KEY=
POSTHOG_HOST=https://us.i.posthog.com
MAX_GENERATE_REQUESTS_PER_WINDOW=5
GENERATE_RATE_LIMIT_WINDOW_MS=60000
GENERATION_TIMEOUT_MS=180000
MAX_EXTRACT_REQUESTS_PER_WINDOW=8
MAX_EXTRACTIONS_PER_USER=80
EXTRACT_RATE_LIMIT_WINDOW_MS=60000
EXTRACTION_TIMEOUT_MS=180000
```

`SUPABASE_SERVICE_ROLE_KEY` is server-only and must not be exposed to the browser.
`NEXT_PUBLIC_APP_URL` controls generated auth redirects, share links, and metadata. Set it to `https://moodblendy.com` in production.
`GOOGLE_FONTS_API_KEY` is optional and only needed to resolve fonts by Google Fonts family name. Direct `.ttf`, `.otf`, and `.woff` font URLs work without it.
Set `NEXT_PUBLIC_TLDRAW_LICENSE_KEY` before public deploy to remove the production license watermark.
`NEXT_PUBLIC_POSTHOG_KEY` and `NEXT_PUBLIC_POSTHOG_HOST` enable client funnel events. `POSTHOG_SERVER_KEY` and `POSTHOG_HOST` are optional server-side overrides for API events; if omitted, server capture falls back to `NEXT_PUBLIC_POSTHOG_KEY`.

## Supabase setup.

Enable Supabase Auth email/password. Decide whether the demo should require email confirmation:

- More secure: leave **Confirm email** enabled, so password signups must confirm before login.
- Lower friction demo: disable **Confirm email** in Supabase Auth settings, so signup creates an immediate session.

Enable the Google provider in Supabase Auth and add your deployed site URL, `https://moodblendy.com`, as an allowed redirect URL for Google OAuth.

Create the boards table:

```sql
create extension if not exists pgcrypto;

create table if not exists public.boards (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid references auth.users(id) on delete cascade,
  title text not null default 'Untitled board',
  brief text not null default '',
  document jsonb not null default '{}'::jsonb,
  share_id text not null unique default encode(gen_random_bytes(9), 'base64url'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.boards enable row level security;

create policy "owners can read boards"
on public.boards for select
using (auth.uid() = owner_id);

create policy "owners can insert boards"
on public.boards for insert
with check (auth.uid() = owner_id);

create policy "owners can update boards"
on public.boards for update
using (auth.uid() = owner_id)
with check (auth.uid() = owner_id);

-- Public sharing is served by /b/[share_id] through a server route that
-- queries a single share_id with SUPABASE_SERVICE_ROLE_KEY. Do not add a
-- broad anon read policy for boards unless you redesign sharing.
```

Apply the profiles/usage migration in `supabase/migrations/202606140001_profiles_usage.sql`. It creates:

- `public.profiles` with `user_id`, `images_used`, and `created_at`.
- RLS allowing users to read only their own profile.
- An auth trigger that creates a profile row when a Supabase user signs up.
- SECURITY DEFINER RPCs for atomic image reservation and refund.

Create public storage buckets:

```sql
insert into storage.buckets (id, name, public)
values
  ('moodboard-imports', 'moodboard-imports', true),
  ('moodboard-elements', 'moodboard-elements', true),
  ('moodboard-outputs', 'moodboard-outputs', true)
on conflict (id) do update set public = excluded.public;
```

The import route writes full source images to `moodboard-imports`, extraction writes transparent cutouts to `moodboard-elements`, and generation writes outputs to `moodboard-outputs`.

## Run locally

```bash
npm install
npm run dev
```

Open the printed local URL. For image upload, pasted URL import, clipboard image import, and generated output storage, configure the Supabase env vars first. For generation, also set `FAL_KEY`.

Useful checks:

```bash
npm test
npm run lint
npm run build
npm run fixtures
```

## Current workflow

Round 3 acceptance:

- Import source images by upload, pasted URL, and clipboard image into the Sources rail.
- Extract a subject or a described object from a source into a transparent, labeled, taggable `element` shape.
- Extract palette from a source to create a `swatch`.
- Add type samples and notes to the board.
- Toggle tag chips on elements.
- Open Chat and send an instruction to run 2 fal.ai generations through `POST /api/generate`.
- Watch outputs fill the tray progressively as each generation resolves.
- Use Add to board on a chat image to add it as a taggable `element`.
- Drag a finished tray image onto the board as a secondary convenience path.
- Select a finished tray image, enter a headline and either a Google Fonts name or direct `.ttf`/`.otf`/`.woff` URL, then click Add text to append a composited output to the tray.
- Swatch colors are injected directly into the assembled prompt.
- Element cutout URLs are sent as generation references.
- Users must sign up or log in before reaching the board. Email/password, Google OAuth, and magic links are supported.
- Logged-in users get one persisted board that autosaves the serialized tldraw document and brief.
- Each user gets 10 free generated images. The remaining quota is shown in the UI and enforced in `/api/generate`.
- The floating Chat widget turns conversational instructions into generation prompts, streams generated images into the thread, and can add any chat image back to the board.
- Comment mode drops persisted `comment-pin` shapes on the canvas with replies, resolve controls, and a resolved-comment filter.
- The Share control copies `https://moodblendy.com/b/[share_id]` when `NEXT_PUBLIC_APP_URL` is set for production.
- Shared pages render the persisted tldraw document read-only, without edit controls or generation.

## Generation route

`POST /api/generate` accepts:

```json
{
  "boardId": "local-board-id",
  "count": 2,
  "board": {
    "brief": "A one-line brief",
    "elements": [{ "url": "https://...", "label": "bear", "tags": ["subject"] }],
    "swatches": [{ "colors": ["#111827", "#f97316"] }],
    "typeSamples": [{ "label": "Condensed grotesk" }],
    "notes": [{ "text": "sun-bleached and tactile" }]
  }
}
```

The response is newline-delimited JSON. The route ignores client-supplied counts and always attempts exactly 2 images per prompt. Each generated fal.ai image is fetched server-side, stored in `moodboard-outputs`, then streamed to the client as an `output` event with the Supabase Storage URL.

`/api/generate` requires a Supabase bearer token. Before calling fal.ai, it atomically reserves 2 images against `profiles.images_used` with `reserve_profile_images`; if `images_used + 2 > 10`, it returns `{ code: "limit_reached" }` and does not call fal.ai. After the stream settles, failed or cancelled outputs are refunded with `refund_profile_images`, so parallel requests cannot push a user past the 10-image cap.

## Compose text

After generation, select an output in the tray and use the Compose text controls to render exact headline text onto the image. Font names are resolved through the Google Fonts Developer API when `GOOGLE_FONTS_API_KEY` is set; direct `.ttf`, `.otf`, and `.woff` URLs work without a key. The image model is not asked to draw text: the server parses the real font with `opentype.js`, converts the glyphs to SVG paths, composites them over the selected PNG with `sharp`, stores the result in `moodboard-outputs`, and adds the new image to the tray.

Use fonts you are licensed to use. Google Fonts families are generally safe for this flow because they are served under open licenses such as OFL or Apache.

## Conversational generation

The floating Chat widget sends the current conversation plus a summary of the board to `POST /api/chat`. The route uses local app logic to turn recent user messages into a generation direction; there is no extra LLM provider or API key in this version. The client then reuses `POST /api/generate` with that prompt and the current board references, so the assembler, fal.ai model, storage, and add-to-board flow stay shared.

Chat history is saved inside the board document as `chat`, alongside `sources` and `tldraw`, and reloads with the board.

## Analytics

PostHog capture is implemented without an extra package. Configure `NEXT_PUBLIC_POSTHOG_KEY` for browser events and optionally `POSTHOG_SERVER_KEY` for API-side events.

Instrumented events:

- `signup`
- `login`
- `generate` with `output_count`
- `extract`
- `add_to_board`
- `share`
- `limit_reached`

## Comments

The Comment toolbar toggle enables click-to-drop canvas comments. Each comment is a custom tldraw `comment-pin` shape with `{ author, text, replies, resolved, createdAt }`, so comments persist through the existing tldraw snapshot autosave. Resolved pins render dimmed and can be hidden with the resolved-comment filter.

## Extraction routes

- `POST /api/extract` accepts `{ sourceUrl, mode: "subject" | "describe", prompt? }`.
- `subject` uses `fal-ai/birefnet` with a `fal-ai/imageutils/rembg` fallback.
- `describe` uses `fal-ai/evf-sam`.
- Returned cutouts are re-hosted to `moodboard-elements`.
- `POST /api/extract-palette` accepts `{ sourceUrl }` and returns hex colors for creating a swatch.

## Auth, Autosave, Sharing

The browser uses `NEXT_PUBLIC_SUPABASE_ANON_KEY` only for Supabase Auth. Board persistence goes through authenticated app routes:

- `GET /api/boards` loads or creates the current user's board.
- `PATCH /api/boards/[id]` autosaves `{ brief, document }`.
- `GET /api/public-board/[shareId]` reads a public shared board.
- `/b/[shareId]` renders the share page read-only.

The `document` column stores `{ version: 2, sources, tldraw }`, where `sources` are full source images for the side rail and `tldraw` is the serialized tldraw store snapshot.

## Fixture harness

Fixture boards live in `fixtures/boards`. Run:

```bash
npm run fixtures
```

This recompiles them into `fixtures/compiled` with a deterministic mock extracted palette, so assembler changes can be eyeballed without network access or generation spend.
