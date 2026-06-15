## The Root Cause Taxonomy: Two Completely Different Bugs

Before jumping to solutions, it's critical to understand that "chunk load error" is actually **two distinct failure modes** that happen to produce the same error string. Conflating them leads to half-fixes.

### Failure Mode 1 — Version Skew (the dominant cause)

When you dynamically import a route or component, Vite creates a separate chunk with a content-hashed filename like `Overview-abc123.js`. If you change any transitive dependency of that component, the hash changes to something like `Overview-32ab1c.js`. Clients who already loaded the old `index.html` still reference `abc123` — which no longer exists after deployment — and get a "Failed to fetch dynamically imported module" error.

This is **deterministic** — it will happen to every user with an open tab during or after every deploy. It's not a bug in your code; it's a fundamental tension in SPA deployment.

### Failure Mode 2 — Transient Network Error

More chunks mean more requests, which means more chances of a network failure. If any one of the requested chunks fails due to a bad router, spotty connection, or server transience, the same `ChunkLoadError` is triggered.

This is **non-deterministic** and retryable. The treatment is different.

### Why the Browser Won't Let You Retry Dynamic Imports

A critical constraint shapes all solutions here: you cannot retry the dynamic import due to browser limitations (see WHATWG HTML issue #6768). The error may also occur if browser extensions (like ad-blockers) are blocking that request — it might be possible to work around by selecting a different chunk name via `build.rolldownOptions.output.chunkFileNames`, since these extensions often block requests based on file names containing words like "ad" or "track".

This is why retry wrappers you see in older Webpack-era articles are incomplete for Vite — the browser caches the failed module fetch and any retry returns the same failure.

---

## The 3-Layer Defense System

A robust solution requires **all three layers simultaneously**. Each handles a different class of failure.

```
┌─────────────────────────────────────────────────────────┐
│  Layer 3 — Proactive: Version Poller                    │  ← Catch before crash
│  Polls version.json, notifies user of new deploy early  │
├─────────────────────────────────────────────────────────┤
│  Layer 2 — Reactive (render path): Error Boundary       │  ← Catch lazy render failure
│  Catches chunk errors bubbling from Suspense/lazy       │
├─────────────────────────────────────────────────────────┤
│  Layer 1 — Reactive (preload path): vite:preloadError   │  ← Catch Vite preload failure
│  Handles Vite's modulepreload polyfill failures         │
└─────────────────────────────────────────────────────────┘
```

---

## Layer 1: `vite:preloadError` — Vite's Built-in Hook

This is the foundation. Vite emits a `vite:preloadError` event when it fails to load dynamic imports. `event.payload` contains the original import error. If you call `event.preventDefault()`, the error will not be thrown.

When a new deployment occurs, the hosting service may delete the assets from previous deployments. As a result, a user who visited your site before the new deployment might encounter an import error. This error happens because the assets running on that user's device are outdated and it tries to import the corresponding old chunk, which is deleted.

The naive implementation is `window.addEventListener('vite:preloadError', () => window.location.reload())` — but this is dangerous. That could cause infinite reloads if there is some other issue with the network. To avoid that, improve the basic reload by counting the number of times it has already tried, and then give up if it exceeds a threshold.

The `chunkErrorGuard.ts` file above implements this with a `sessionStorage`-based counter with a time window reset. The key nuance: we store the last chunk error message and timestamp in `sessionStorage`, and suppress repeats of the same failure for a few minutes. That means a stale tab can recover after a deploy, but one bad chunk does not turn into an infinite refresh loop.

---

## Layer 2: `ChunkErrorBoundary` — Catching the Render Path

Not every chunk failure surfaces through `vite:preloadError`. Errors thrown during component render (e.g., when Preact tries to mount a lazily imported component that failed) bubble up through the component tree. A basic solution is to catch chunk loading errors with a React/Preact error boundary component. You use `getDerivedStateFromError` to detect chunk errors and display a message to the user with a page refresh button.

The `ChunkErrorBoundary.tsx` above does this but also **auto-reloads** on the first N failures (respecting the same counter) before falling back to a user-facing "Reload to update" button. This is critical for zero-click recovery on the happy path.

The error fingerprint check must cover multiple error messages since different browsers produce different strings:
- Chrome: `"Failed to fetch dynamically imported module"`
- Safari: `"Importing a module script failed"`
- Older Chromium: `"error loading dynamically imported module"`
- Vite-specific: `"ChunkLoadError"`
- CSS preload: `"Unable to preload CSS"`

---

## Layer 3: The Version Poller — Proactive UX

The version detection implementation is straightforward: periodically fetch the main `version.json` file and compare it to the current version baked in at build time. If there is a difference, a new version has been deployed.

The philosophy here is **catch before the crash**. A user who sees a "New version available — update now" banner and voluntarily reloads has a vastly better experience than one whose navigation to `/dashboard` suddenly white-screens. The `versionPoller.ts` dispatches a `CustomEvent("app:new-version")` that your App component can listen to and render a non-intrusive banner.

Polling design constraints:
- Use `cache: 'no-store'` on the fetch — bypasses CDN/browser cache
- `version.json` must be served with `Cache-Control: no-store`
- Poll every 5 minutes (tunable to 2–3 min for high-frequency deploy orgs)
- Stop polling after first mismatch detected — one notification is enough
- Delay the first poll 10 seconds — don't compete with initial render

---

## Infrastructure: The Most Underrated Layer

Most engineering discussions focus on the JS runtime solutions. In practice, the **infrastructure layer is equally important** — and getting it wrong breaks the runtime solutions.

### Cache Headers: The Asymmetric Model

The asymmetry is the whole model — long-lived cache for immutable assets, short-lived cache for the pointer that references them. Hashed assets get `max-age=31536000, immutable`. The HTML gets `no-cache` or a very short max-age with `must-revalidate`, so CDN edges always check with the origin for freshness.

```
/index.html          → Cache-Control: no-cache
/assets/*.js         → Cache-Control: public, max-age=31536000, immutable
/version.json        → Cache-Control: no-store
```

The `immutable` directive tells browsers and CDN edges never to revalidate — since the URL changes when the content changes, the old URL is correct forever.

### The Silent Killer: 200 HTML Masquerading as a Missing JS File

In a React + Vite app on Cloudflare Pages, stale lazy-loaded chunks were returning `200 text/html` instead of `404`. The browser was asking for JavaScript and getting the SPA HTML shell. The fix was adding `public/assets/404.html` so missing `/assets/*.js` files return a real `404 no-store`, while normal client-side app routes still fall back to the React app.

This is the most pernicious failure mode: the `vite:preloadError` event doesn't fire reliably, the error message is confusing ("not a valid MIME type"), and nothing in the runtime layers catches it correctly. Your nginx/CDN config in `vite.config.ts` above shows the correct `try_files $uri =404` directive for `/assets/` — never fall back to `index.html` for asset paths.

### Keep Old Chunks Alive: The Grace Period Strategy

Consider keeping the previous deployment's chunks for a period to allow cached users to transition smoothly. This is what AWS Amplify's Skew Protection formalizes: when a request comes in, Amplify Hosting identifies the deployment version that originated the request and routes it to the identified version of the asset. All assets from a single user session come from the same deployment. New user sessions always get the latest version, while existing sessions continue working with their original version until refresh.

Without a platform-level solution like Amplify, you can implement this yourself by **never deleting** old hashed assets from S3/CDN. Since files are content-hashed, they don't conflict. The cost is marginal storage growth — acceptable for most orgs. Set a 30-day lifecycle policy on S3 to clean up truly stale builds.

### Vite `manualChunks`: Minimize Invalidation Surface

The `vite.config.ts` above splits `preact` and `preact-router` into stable vendor chunks. The reasoning: if vendor code doesn't change between deploys (it usually doesn't), the vendor chunk hash stays the same and is served from browser cache. Only the changed app chunks produce new hashes. Fewer new hashes = fewer stale chunk errors during the transition window = smaller blast radius per deploy.

---

## Integration Pattern (wiring order in `main.tsx`)

```ts
// 1. Guard BEFORE render — event listener must be in place before any lazy import
mountChunkErrorGuard();

// 2. Start poller with build-time version
startVersionPoller({ currentVersion: __APP_VERSION__ });

// 3. Render with error boundary wrapping the router
render(
  <ChunkErrorBoundary>
    <App />   // lazy routes live inside here
  </ChunkErrorBoundary>,
  document.getElementById("app")!
);
```

---

## Edge Cases to Handle

| Scenario | What happens | Guard behavior |
|---|---|---|
| User has tab open 3 days, deploys happened | Clicks link → chunk 404 | Layer 1 fires, reload count = 0, hard reload succeeds |
| Network drops mid-import (not version skew) | Transient 404 or timeout | Same — reload usually succeeds; if not, max 3 retries |
| Browser ad-blocker blocks chunk by filename | Persistent 404 | Max reloads hit, user sees manual retry UI |
| CDN edge returns 200 HTML for 404 | Silent parse failure, bad MIME type | Must be fixed at infra level (nginx `try_files $uri =404`) |
| User reloads manually mid-transition | Fresh HTML + fresh chunk URLs | No issue; counter resets after 60-second window |
| Multiple tabs open, deploy happens | All tabs independently detect | Each tab manages its own sessionStorage counter independently |
| Rollback deployment | Old chunks hash back into existence | Works — version poller notifies, reload gets old-but-valid chunks |

---

## Interviewer Follow-up: Why not just retry the dynamic import?

The `importRetry` wrapper pattern from older articles (with exponential backoff) doesn't work for Vite's module loading path because **browsers cache failed module fetches per the WHATWG spec**. A retry call to the same URL returns the cached failure immediately — the network is never hit. The only recovery is a full navigation (`window.location.href = path` or `window.location.reload()`), which is exactly what all three layers do.

The exception is if you're making a raw `fetch()` for non-ESM assets — in that case, a cache-busted URL (`?t=${Date.now()}`) can bypass the cache. But for ESM dynamic imports, this is not available.
