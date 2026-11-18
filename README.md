# Moodblendy

Moodblendy is a reference-driven AI moodboard app. The current model is sources -> elements -> composition: full source images live in a side rail, extracted transparent cutout elements populate the native transform canvas, and generation composes from those elements plus swatches, type samples, notes, and the brief.

## Required environment variables

```bash
FAL_KEY=
RUNPOD_API_KEY=
RUNPOD_ENDPOINT_ID=cu3rkjepnei4j2
RUNPOD_IMAGE_WIDTH=1024
RUNPOD_IMAGE_HEIGHT=1024
GOOGLE_FONTS_API_KEY=
NEXT_PUBLIC_APP_URL=https://moodblendy.com
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
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

`SUPABASE_SERVICE_ROLE_KEY` and `RUNPOD_API_KEY` are server-only and must not be exposed to the browser.
`RUNPOD_ENDPOINT_ID` defaults to the FLUX.2 Klein endpoint shown above. `RUNPOD_ENDPOINT_URL` can override the full Runpod `runsync` URL when needed.
`NEXT_PUBLIC_APP_URL` controls generated auth redirects, share links, and metadata. Set it to `https://moodblendy.com` in production.
`GOOGLE_FONTS_API_KEY` is optional and only needed to resolve fonts by Google Fonts family name. Direct `.ttf`, `.otf`, and `.woff` font URLs work without it.
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

## MCP server for ChatGPT

A lightweight MCP server is available at `mcp/server.ts` so ChatGPT-style clients can call a Moodblendy tool over stdio.

```bash
npm run mcp
```

Example MCP client config:

```json
{
  "mcpServers": {
    "moodblendy": {
      "command": "npm",
      "args": ["run", "mcp", "--", "--stdio"]
    }
  }
}
```

The tool name is `moodblendy.create_board`. It accepts a brief, style, colors, references, and notes, then returns a structured prompt payload that the app can use for board generation.

Open the printed local URL. For image upload, pasted URL import, clipboard image import, and generated output storage, configure the Supabase env vars first. For image generation, also set `RUNPOD_API_KEY`. `FAL_KEY` is only required for the optional 3D orbit feature.

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
- Open Chat and send an instruction to run 2 FLUX.2 Klein generations on Runpod through `POST /api/generate`.
- Watch outputs fill the tray progressively as each generation resolves.
- Use Add to board on a chat image to add it as a taggable `element`.
- Drag a finished tray image onto the board as a secondary convenience path.
- Select a finished tray image, enter a headline and either a Google Fonts name or direct `.ttf`/`.otf`/`.woff` URL, then click Add text to append a composited output to the tray.
- Swatch colors are injected directly into the assembled prompt.
- Up to four visual references are sent to FLUX.2 Klein, with identity, pose, and outfit roles prioritized.
- The included custom `runpod-worker` accepts up to four native reference images. For single-image workers, the API also supplies an ordered 1024px compatibility sheet through `image`.
- Element labels, roles, palette, notes, and type direction are assembled into the FLUX.2 prompt and aligned with the reference order.
- Users must sign up or log in before reaching the board. Email/password, Google OAuth, and magic links are supported.
- Logged-in users can create, open, and switch between persisted boards. The active board autosaves its serialized native canvas document and brief.
- Each user gets 10 free generated images. The remaining quota is shown in the UI and enforced in `/api/generate`.
- The floating Chat widget turns conversational instructions into generation prompts, streams generated images into the thread, and can add any chat image back to the board.
- Comment mode drops persisted `comment-pin` shapes on the canvas with replies, resolve controls, and a resolved-comment filter.
- The Share control copies `https://moodblendy.com/b/[share_id]` when `NEXT_PUBLIC_APP_URL` is set for production.
- Shared pages render the persisted native canvas document read-only, without edit controls or generation.

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

The response is newline-delimited JSON. The route ignores client-supplied counts and model choices and always attempts exactly 2 FLUX.2 Klein images per prompt. Before inference, the route prioritizes and de-duplicates up to four board references, builds an ordered reference sheet when more than one image is present, and sends it through the worker's `image` input. It also sends `images` and `image_urls` arrays so a native multi-reference worker can consume the originals. Runpod may return an image URL, data URL, or base64 image; the route normalizes the result, stores it in `moodboard-outputs`, then streams an `output` event with the Supabase Storage URL.

Runpod public text-to-image endpoints validate a prompt-only schema and reject reference fields with `INVALID_INPUT`. Reference-conditioned generation therefore requires the custom worker in [`runpod-worker`](./runpod-worker/README.md), not the public FLUX.2 Klein text-to-image endpoint.

`/api/generate` requires a Supabase bearer token. Before calling Runpod, it atomically reserves the required credits; insufficient balances are rejected before inference. After the stream settles, failed or cancelled outputs are refunded, so parallel requests cannot overspend a user's balance.

## Compose text

After generation, select an output in the tray and use the Compose text controls to render exact headline text onto the image. Font names are resolved through the Google Fonts Developer API when `GOOGLE_FONTS_API_KEY` is set; direct `.ttf`, `.otf`, and `.woff` URLs work without a key. The image model is not asked to draw text: the server parses the real font with `opentype.js`, converts the glyphs to SVG paths, composites them over the selected PNG with `sharp`, stores the result in `moodboard-outputs`, and adds the new image to the tray.

Use fonts you are licensed to use. Google Fonts families are generally safe for this flow because they are served under open licenses such as OFL or Apache.

## Conversational generation

The floating Chat widget sends the current conversation plus a summary of the board to `POST /api/chat`. The route uses local app logic to turn recent user messages into a generation direction; there is no extra LLM provider or API key in this version. The client then reuses `POST /api/generate` with that prompt, so the assembler, Runpod FLUX.2 model, storage, and add-to-board flow stay shared.

Chat history is saved inside the board document as `chat`, alongside `sources` and `canvas`, and reloads with the board.

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

The Comment toolbar toggle enables click-to-drop canvas comments. Each comment is a native `comment-pin` node with `{ author, text, replies, resolved, createdAt }`, so comments persist through the canvas document autosave. Resolved pins render dimmed and can be hidden with the resolved-comment filter.

## Extraction routes

- `POST /api/extract` accepts `{ sourceUrl }`.
- Subject extraction runs locally with `@imgly/background-removal-node`; it does not use an external API or credits.
- `sharp` normalizes the input and trims transparent pixels around the extracted foreground.
- Returned PNG cutouts are stored in `moodboard-elements`.
- `POST /api/extract-palette` accepts `{ sourceUrl }` and returns hex colors for creating a swatch.

## Auth, Autosave, Sharing

The browser uses `NEXT_PUBLIC_SUPABASE_ANON_KEY` only for Supabase Auth. Board persistence goes through authenticated app routes:

- `GET /api/boards` lists the current user's boards and loads the requested (or active) board.
- `POST /api/boards` creates a new board.
- `PATCH /api/boards/[id]` autosaves `{ brief, document }`.
- `GET /api/public-board/[shareId]` reads a public shared board.
- `/b/[shareId]` renders the share page read-only.

The `document` column stores `{ version: 3, sources, canvas }`, where `sources` are full source images for the side rail and `canvas` is the serialized native node document. Legacy version 2 records are normalized when loaded.

## Fixture harness

Fixture boards live in `fixtures/boards`. Run:

```bash
npm run fixtures
```

This recompiles them into `fixtures/compiled` with a deterministic mock extracted palette, so assembler changes can be eyeballed without network access or generation spend.
# Payments and credits

Moodblendy uses Stripe Checkout with a Supabase-backed prepaid credit wallet. Apply
`supabase/migrations/202608070001_credit_wallet_stripe.sql`, then configure:

```env
STRIPE_SECRET_KEY=sk_test_...
STRIPE_WEBHOOK_SECRET=whsec_...
CREDIT_MARKUP_MULTIPLIER=5
APP_CREDITS_PER_USD=100
FAL_COST_GENERATE_IMAGE_USD=0.15
FAL_COST_EXTRACT_SUBJECT_USD=0.005
FAL_COST_EXTRACT_DESCRIBE_USD=0.005
FAL_COST_SAM_3D_OBJECTS_USD=0.02
```

For local webhooks, run `stripe listen --forward-to localhost:3000/api/stripe/webhook`.
The webhook—not the Checkout redirect—grants purchased credits.
