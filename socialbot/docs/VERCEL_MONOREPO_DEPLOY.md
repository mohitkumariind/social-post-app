# Vercel deploy (monorepo)

## Project settings

- **Root Directory:** `socialbot` (recommended), **or** repo root with root `vercel.json` pointing at `socialbot/`.
- **Framework:** Next.js
- **Build command:** `npm run build` (when Root Directory is `socialbot`)

## Twitter campaign workers API

| URL | Notes |
|-----|--------|
| `POST /api/admin/twitter-campaigns/workers` | Canonical App Router path |
| `POST /api/admin/twitter-campaign-workers` | Legacy; rewritten to canonical in `socialbot/vercel.json` |

Do **not** set Turbopack root to the repo root: the Expo app also has an `app/` directory and can break route discovery.

## Stale 404 on a new API route

If middleware returns 200 but the route is 404 with **Cache: HIT** on `/404`:

1. Redeploy after the route ships.
2. In Vercel → Project → Settings → General → **Clear Build Cache**, then redeploy.
3. Prefer the canonical URL above when testing.

Optional one-off: set env `VERCEL_FORCE_NO_BUILD_CACHE=1` for a single production deploy, then remove it.
