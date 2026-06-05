# AI Moodboard MVP

Working MVP for a reference-driven AI moodboard. The current model is sources -> elements -> composition: full source images live in a side rail, extracted transparent cutout elements populate the tldraw board, and generation composes from those elements plus swatches, type samples, notes, and the brief.

## Required environment variables

```bash
FAL_KEY=
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
NEXT_PUBLIC_TLDRAW_LICENSE_KEY=
MAX_GENERATIONS_PER_BOARD=40
MAX_GENERATIONS_PER_USER=80
MAX_GENERATE_REQUESTS_PER_WINDOW=5
GENERATE_RATE_LIMIT_WINDOW_MS=60000
GENERATION_TIMEOUT_MS=180000
MAX_EXTRACT_REQUESTS_PER_WINDOW=8
MAX_EXTRACTIONS_PER_USER=80
EXTRACT_RATE_LIMIT_WINDOW_MS=60000
EXTRACTION_TIMEOUT_MS=180000
```

`SUPABASE_SERVICE_ROLE_KEY` is server-only and must not be exposed to the browser.
Set `NEXT_PUBLIC_TLDRAW_LICENSE_KEY` before public deploy to remove the production license watermark.

## Supabase setup

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
- Write a one-line brief above the canvas.
- Click Generate to run 6 concurrent fal.ai generations through `POST /api/generate`.
- Watch outputs fill the tray progressively as each generation resolves.
- Select a finished tray image or use its visible Add to board button to add it as a taggable `element`.
- Drag a finished tray image onto the board as a secondary convenience path.
- Swatch colors are injected directly into the assembled prompt.
- Element cutout URLs are sent as generation references.
- Users can request a Supabase magic link with the Save login control.
- Logged-in users get one persisted board that autosaves the serialized tldraw document and brief.
- The Share control copies `/b/[share_id]`.
- Shared pages render the persisted tldraw document read-only, without edit controls or generation.

## Generation route

`POST /api/generate` accepts:

```json
{
  "boardId": "local-board-id",
  "count": 6,
  "board": {
    "brief": "A one-line brief",
    "elements": [{ "url": "https://...", "label": "bear", "tags": ["subject"] }],
    "swatches": [{ "colors": ["#111827", "#f97316"] }],
    "typeSamples": [{ "label": "Condensed grotesk" }],
    "notes": [{ "text": "sun-bleached and tactile" }]
  }
}
```

The response is newline-delimited JSON. Each generated fal.ai image is fetched server-side, stored in `moodboard-outputs`, then streamed to the client as an `output` event with the Supabase Storage URL. The route enforces a server-side generation cap per local board id with `MAX_GENERATIONS_PER_BOARD`, defaulting to 40.
It also enforces an in-memory per-user/IP cap and request rate limit with the env vars above. For a multi-instance deployment, move those counters to durable storage.

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
