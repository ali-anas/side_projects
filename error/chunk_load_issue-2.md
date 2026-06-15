## Re-diagnosis: Your Problem Is Categorically Different

This is the key insight the previous answer missed. You stated: **every page load is fresh — the backend redirects to the page URL, no browser caching of HTML.** This completely eliminates version skew as your primary cause. You're not hitting a stale-tab problem. Let's map your actual failure modes:

```
User hits merchant checkout URL
        ↓
Backend generates session → redirects to /checkout?session=xyz
        ↓
Browser loads fresh index.html (no cache)
        ↓
index.html boots → fetches entry chunk (main-[hash].js) ✅
        ↓
App initializes → fires dynamic imports for feature chunks
 ┌──────────────────────────────────────────────────────────┐
 │  THIS is where failure happens — 3 distinct root causes  │
 └──────────────────────────────────────────────────────────┘
```

---

## The 3 Actual Root Causes For Your Architecture

### Root Cause 1 — Deployment Race Window (Most Likely)

CDN edge nodes cache chunks across global edge nodes. A chunk may exist on the origin server but not yet propagate to a user's nearest edge node (stale cache).

Your deployment sequence creates a brief but real race:

```
T+0s  : New build uploaded to origin (new hashes)
T+0s  : index.html updated (references new hashes)    ← CDN purge propagates fast
T+30s : CDN edge nodes still have old chunk files cached ← old hash content
T+35s : User hits checkout → gets NEW index.html → requests NEW chunk hash
T+35s : CDN edge serves 404 for that new hash (not yet propagated)
```

The window is typically 30 seconds to 5 minutes depending on your CDN's propagation time. For a high-traffic checkout, enough users hit this window to produce a measurable error rate.

### Root Cause 2 — Transient Network Failure During Chunk Fetch

Two extremely common Sentry errors on live production sites are `TypeError: Importing a module script failed` and `Unable to preload CSS`. These are almost certainly caused by transient network errors on mobile devices. A checkout page likely sees a high proportion of mobile users on 2G/3G/4G networks — especially in markets like India — where packet loss during a multi-chunk waterfall is common.

Note that you cannot retry the dynamic import due to browser limitations (WHATWG HTML issue #6768). This is the core constraint that makes transient network failures so destructive — a single dropped packet means a permanently failed module load in the current page lifecycle.

### Root Cause 3 — The Vite Preload Waterfall Multiplier

Vite automatically rewrites code-split dynamic import calls with a preload step so that when async chunk A is requested, its transitive dependencies are fetched in parallel. It is possible for the common chunk C to have further imports, resulting in even more roundtrips.

This means one `dynamic import()` in your code actually fires **multiple simultaneous chunk fetches**. Each fetch is an independent failure opportunity. More chunks = higher cumulative probability of at least one failing on a poor connection.

### Root Cause 4 (Less Likely But Real) — Ad Blockers on Payment Pages

The error may also occur if browser extensions (like ad-blockers) are blocking that request. It might be possible to work around by selecting a different chunk name via `build.rolldownOptions.output.chunkFileNames`, as these extensions often block requests based on file names containing words like "ad" or "track". Payment/checkout pages are exactly the kind of page users with privacy-focused browsers visit carefully.

---

## The Correct Solution Architecture For Your Case

Since you don't have a caching problem (fresh HTML per session), your priorities invert from the standard SPA advice:

**Priority 1: Eliminate the dynamic import failure surface** — architectural
**Priority 2: Retry transient failures via fetch() bypass** — runtime
**Priority 3: Graceful error recovery** — UX safety net
**Priority 4: CDN propagation hardening** — infrastructure

---

### Strategy 1 (Highest Impact): Eliminate Dynamic Imports on the Critical Path

This is the most important decision. Something worth noting — taking a slightly slower loading page is far preferable to a page that stops working in the middle of route navigation in a payment flow where friction/dropoff is a problem.

For a **checkout page**, you are not a dashboard with 20 routes. You have one page, one flow. The entire justification for code splitting (don't load code the user won't use) doesn't apply — the user *will* use everything on this page. Bundle it all eagerly.

```ts
// vite.config.ts
export default defineConfig({
  build: {
    rollupOptions: {
      output: {
        // For a single-page checkout: kill all code splitting
        // inlineDynamicImports: true  ← Rollup option (sets codeSplitting: false in Rolldown)
        codeSplitting: false,          // Rolldown (Vite 6+)
      }
    }
  }
})
```

Setting `codeSplitting: false` inlines all dynamic imports into a single bundle (equivalent to the deprecated `inlineDynamicImports: true`).

**One bundle = zero dynamic import failures.** The fetch either succeeds or fails atomically. No mid-session chunk 404. This is what Stripe's own checkout JS (`https://js.stripe.com/v3/`) does — it's one large, self-contained, pre-cacheable script.

**The tradeoff:** Larger initial bundle. For a checkout page, this is almost always acceptable. Users arrive at checkout with intent — a 400KB bundle vs. 6 chunks totaling 400KB has identical wire cost but eliminates all chunk failure modes.

### Strategy 2 (Critical): Fix the Vite Preload Propagation Race via `fetch()` Retry

For any chunks you intentionally keep (payment method SDKs, etc.), implement a fetch-based retry *before* the dynamic import. This bypasses the browser's ESM module cache (which caches failures) by warming the HTTP cache first.

```ts
// retryChunkLoad.ts
// 
// Why fetch() instead of retrying import() directly:
//   The browser caches failed module fetches per the WHATWG spec.
//   import('./Foo.js') after a failure returns the cached error immediately —
//   no network hit. But a successful fetch() of the same URL warms the HTTP
//   cache. The subsequent import() finds the resource in HTTP cache and succeeds.
//   This is the only browser-legal retry path for ESM dynamic imports.
//
// Reference: https://github.com/whatwg/html/issues/6768

const DEFAULT_RETRIES = 3;
const RETRY_DELAY_MS = 1200; // slightly longer than most CDN propagation blips

function wait(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function warmHttpCache(url: string, attempt: number): Promise<boolean> {
  try {
    const res = await fetch(url, {
      // cache: 'no-store' on retry forces a fresh network request
      // bypassing any CDN edge-cached 404 that was cached with a short TTL
      cache: attempt === 0 ? 'default' : 'no-store',
      credentials: 'omit',
    });
    return res.ok;
  } catch {
    return false;
  }
}

export async function retryDynamicImport<T>(
  importFn: () => Promise<T>,
  chunkUrl: string,   // the hashed chunk URL known at build-time
  retries = DEFAULT_RETRIES,
): Promise<T> {
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      if (attempt > 0) {
        await wait(RETRY_DELAY_MS * attempt); // linear backoff
        await warmHttpCache(chunkUrl, attempt); // prime the HTTP cache
      }
      return await importFn();
    } catch (err) {
      const isLast = attempt === retries;
      if (isLast) throw err;
      console.warn(`[retryChunkLoad] attempt ${attempt + 1} failed, retrying...`);
    }
  }
  throw new Error('unreachable');
}
```

> **Why this works:** The WHATWG constraint is that you can't re-fetch a failed ESM module. But `fetch()` and `import()` use **separate cache mechanisms**. A successful `fetch()` populates the HTTP cache. The subsequent `import()` call finds the resource in HTTP cache and succeeds — even though the previous `import()` failed.

### Strategy 3: `vite:preloadError` Guard — Differentiate Network vs. 404

```ts
// chunkErrorGuard.ts — for your server-redirect architecture
// 
// Key difference from standard SPA guard:
//   We DO NOT do a simple window.location.reload() because:
//   1. Backend will redirect us through the session URL again (fine, actually)
//   2. But if the failure is transient network (not version skew), a reload
//      might re-trigger the same failure on a still-degraded connection.
//   
//   Instead: we wait, then reload. The wait absorbs transient blips.
//   The guard still prevents infinite loops via sessionStorage.

const GUARD_KEY = '__chunk_err__';
const MAX_AUTO_RELOADS = 2;    // low — checkout is stateful, don't thrash
const RELOAD_BACKOFF_MS = 2000; // wait before reloading — absorbs network blips

type ChunkErrorEvent = Event & { payload: Error };

function isChunkOrNetworkError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  return (
    err.name === 'ChunkLoadError' ||
    err.message.includes('Failed to fetch dynamically imported module') ||
    err.message.includes('Importing a module script failed') ||
    err.message.includes('Unable to preload CSS') ||
    err.message.includes('error loading dynamically imported module')
  );
}

function getReloadState(): { count: number; ts: number } {
  try {
    const raw = sessionStorage.getItem(GUARD_KEY);
    return raw ? JSON.parse(raw) : { count: 0, ts: 0 };
  } catch {
    return { count: 0, ts: 0 };
  }
}

function recordReload(): void {
  try {
    const state = getReloadState();
    sessionStorage.setItem(GUARD_KEY, JSON.stringify({
      count: state.count + 1,
      ts: Date.now(),
    }));
  } catch {}
}

export function mountChunkErrorGuard(): void {
  window.addEventListener('vite:preloadError', (rawEvent: Event) => {
    const event = rawEvent as ChunkErrorEvent;
    if (!isChunkOrNetworkError(event.payload)) return;

    event.preventDefault(); // suppress Vite's unhandled throw

    const { count, ts } = getReloadState();

    // Reset counter if it's been > 5 minutes (genuine new session attempt)
    const isStale = Date.now() - ts > 5 * 60_000;
    const effectiveCount = isStale ? 0 : count;

    if (effectiveCount >= MAX_AUTO_RELOADS) {
      // Stop auto-reload — dispatch for UI to handle
      window.dispatchEvent(
        new CustomEvent('checkout:chunk:unrecoverable', { detail: event.payload })
      );
      return;
    }

    // Wait before reloading — absorbs transient network blips
    // For checkout: backend redirect will re-establish fresh session context
    setTimeout(() => {
      recordReload();
      window.location.reload();
    }, RELOAD_BACKOFF_MS);
  });
}
```

### Strategy 4: The Fetch-Probe Fallback for Unrecoverable Errors

When auto-reload is exhausted, the worst UX on a checkout page is a blank screen with no explanation. Users assume the payment failed and leave. Show them something actionable.

```tsx
// CheckoutChunkErrorFallback.tsx (Preact)
import { useEffect, useState } from 'preact/hooks';

export function CheckoutChunkErrorFallback() {
  const [checking, setChecking] = useState(true);
  const [isOnline, setIsOnline] = useState(true);

  useEffect(() => {
    // Probe connectivity so we can show the right message
    fetch('/favicon.ico', { cache: 'no-store', method: 'HEAD' })
      .then(r => { setIsOnline(r.ok); setChecking(false); })
      .catch(() => { setIsOnline(false); setChecking(false); });
  }, []);

  const handleRetry = () => {
    // Clear guard state before manual retry
    try { sessionStorage.removeItem('__chunk_err__'); } catch {}
    window.location.reload();
  };

  if (checking) return null; // brief — don't flash UI

  return (
    <div role="alert" style={{ padding: '2rem', textAlign: 'center' }}>
      {isOnline ? (
        <>
          <p>Something went wrong loading the checkout. Please try again.</p>
          <button onClick={handleRetry}>Retry</button>
        </>
      ) : (
        <>
          <p>You appear to be offline. Please check your connection and try again.</p>
          <button onClick={handleRetry}>Retry when connected</button>
        </>
      )}
    </div>
  );
}
```

### Strategy 5: Infrastructure — Solve the CDN Propagation Race

This addresses Root Cause 1. The correct sequence is **assets first, HTML second**:

```
CI/CD Deployment Pipeline (correct order):
─────────────────────────────────────────────────────────────
Step 1: Build → upload ALL new hashed assets to CDN origin
Step 2: Wait for CDN propagation (or issue targeted purge for /assets/*)
Step 3: [OPTIONAL] Probe a canary CDN edge: curl -I https://cdn.yourdomain.com/assets/main-[new-hash].js
         → only proceed when 200
Step 4: Update/deploy new index.html pointing to new hashes
─────────────────────────────────────────────────────────────
```

**Cache headers (non-negotiable):**
```
/assets/*.js, /assets/*.css   → Cache-Control: public, max-age=31536000, immutable
index.html (your backend HTML) → Cache-Control: no-cache, no-store   ← already handled by your backend
```

**Never delete old chunks.** Since you use content hashes, old chunk files never conflict with new ones. Accumulate them. Run a lifecycle policy (e.g., S3 object lifecycle) to delete chunks older than 30 days. This eliminates the propagation race entirely for users who somehow have a stale reference.

**If you use Cloudflare/similar:** Make sure missing `/assets/*.js` files return a real 404 with `no-store`, not a 200 HTML shell. The browser is right when it says "not a valid JavaScript MIME type" — it wanted JavaScript and got HTML. This breaks `vite:preloadError` detection.

---

## Decision Tree: What To Actually Do

```
Is your checkout page a single-view page (no lazy routes inside it)?
│
├─ YES → Use Strategy 1 (codeSplitting: false / inlineDynamicImports)
│         Eliminate ALL dynamic import failures in one shot.
│         Combine with Strategy 3 (vite:preloadError guard) for safety.
│         Combine with Strategy 5 (CDN propagation order).
│
└─ NO  → Keep splitting but apply ALL of:
          - Strategy 2 (fetch() warm cache retry on each dynamic import)
          - Strategy 3 (vite:preloadError guard)
          - Strategy 4 (error UI fallback)
          - Strategy 5 (CDN propagation order + keep old chunks)
```

---

## What NOT To Do (Common Mistakes For Your Architecture)

| Mistake | Why it's wrong for you |
|---|---|
| Version poller / `version.json` | Version skew is not your problem — fresh HTML per session |
| `sessionStorage` reload loop guard with 1 attempt | Checkout is stateful. 1 auto-reload is the correct maximum for payment pages — more risks user seeing blank screen mid-payment |
| `window.location.reload()` immediately on error | On a transient network blip, an immediate reload hits the same degraded connection. Wait 2s first |
| Retry `import()` directly | Browser spec caches failed ESM module fetches — retry is a no-op |
| Removing old CDN chunks on deploy | Creates a race window where users get new HTML but CDN edge hasn't propagated new chunks yet |

---

## Summary: Your Action Plan

1. **Immediate (today):** If your checkout is a single view, set `codeSplitting: false` in `vite.config.ts`. This eliminates the failure class entirely.
2. **Immediate:** Mount `vite:preloadError` guard in `main.tsx` before render, with a 2s delay before reload and max 2 reloads.
3. **This week:** Fix your CDN deployment order — assets before HTML, never delete old hashed chunks.
4. **This week:** Audit chunk names for words like `ad`, `track`, `analytics` — rename via `chunkFileNames` if found.
5. **If keeping chunks:** Wrap remaining dynamic imports with the `fetch()` warm-cache retry wrapper.
6. **Add Sentry/Datadog chunk error alerting** — tag errors with the chunk URL, CDN region, and user agent to identify whether failure is CDN propagation, network, or ad-blocker.
