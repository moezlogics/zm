"use client"

import { useEffect, useRef } from "react"
import { usePathname } from "next/navigation"
import { ensureAdSenseLoaded } from "@modules/analytics/adsense-loader"

type GoogleAdProps = {
  /** AdSense ad-unit slot id. Defaults to the site's responsive unit. */
  slot?: string
  /** Reserved height (px) so the slot holds space before the ad fills. */
  minHeight?: number
  /** Extra classes on the wrapper (spacing, etc.). */
  className?: string
}

const AD_CLIENT = "ca-pub-8616277671572207"
const DEFAULT_SLOT = "6428686902"

/**
 * Google AdSense slot — reliable on Next.js App Router (SSR + SPA nav).
 *
 * WHY THIS REWRITE — the old version did:
 *   const adsbygoogle = window.adsbygoogle || []
 *   adsbygoogle.push({})
 * When the AdSense loader hadn't defined `window.adsbygoogle` yet (slow
 * network, or before the afterInteractive script ran), that pushed into a
 * THROWAWAY local array AdSense never reads → the ad silently never loaded.
 * That is the "ads load hi nahi hote → no impressions → no clicks → no
 * revenue" bug.
 *
 * Fixes:
 *  1. Assign back to window: `(window.adsbygoogle = window.adsbygoogle || []).push({})`
 *     so the request reaches AdSense even before the loader finishes (it
 *     drains the queued pushes once it loads).
 *  2. Push EXACTLY ONCE per slot (ref guard) → no "All ins elements already
 *     have ads" duplicate-init errors.
 *  3. Wait until the <ins> actually has width — AdSense permanently skips a
 *     0-width slot (availableWidth=0 → blank forever) — and retry until the
 *     loader is ready.
 *  4. Remount per route (`key={pathname}`) so a fresh ad fills on every
 *     client-side navigation, not just the first page.
 */
export default function GoogleAd({
  slot = DEFAULT_SLOT,
  minHeight = 100,
  className = "",
}: GoogleAdProps) {
  const pathname = usePathname()
  const insRef = useRef<HTMLModElement | null>(null)
  const pushed = useRef(false)

  useEffect(() => {
    pushed.current = false
    let tries = 0
    let timer: ReturnType<typeof setTimeout> | undefined
    let observer: IntersectionObserver | undefined

    const tryFill = () => {
      const ins = insRef.current
      if (!ins || pushed.current) return
      if (ins.getAttribute("data-adsbygoogle-status") === "done") {
        pushed.current = true
        return
      }
      if (ins.getBoundingClientRect().width === 0) {
        if (tries++ < 25) timer = setTimeout(tryFill, 150)
        return
      }
      try {
        const w = window as Window & { adsbygoogle?: unknown[] }
        ;(w.adsbygoogle = w.adsbygoogle || []).push({})
        pushed.current = true
        // #region agent log
        fetch("http://127.0.0.1:7489/ingest/fc89e651-bfd9-4ece-8a01-30fee9370848", {
          method: "POST",
          headers: { "Content-Type": "application/json", "X-Debug-Session-Id": "90b8a9" },
          body: JSON.stringify({
            sessionId: "90b8a9",
            runId: "lcp-fix",
            hypothesisId: "H3-adsense",
            location: "google-ad/index.tsx",
            message: "Ad slot push succeeded",
            data: { slot, pathname: pathname?.slice(0, 40) },
            timestamp: Date.now(),
          }),
        }).catch(() => {})
        // #endregion
      } catch {
        if (tries++ < 25) timer = setTimeout(tryFill, 200)
      }
    }

    const startFill = () => {
      ensureAdSenseLoaded(AD_CLIENT)
        .then(() => tryFill())
        .catch(() => {
          if (tries++ < 25) timer = setTimeout(tryFill, 300)
        })
    }

    const wrapper = insRef.current?.parentElement
    if (wrapper && "IntersectionObserver" in window) {
      observer = new IntersectionObserver(
        (entries) => {
          if (entries.some((e) => e.isIntersecting)) {
            observer?.disconnect()
            startFill()
          }
        },
        { rootMargin: "240px 0px" }
      )
      observer.observe(wrapper)
    } else {
      timer = setTimeout(startFill, 0)
    }

    return () => {
      observer?.disconnect()
      if (timer) clearTimeout(timer)
    }
  }, [pathname, slot])

  return (
    <div
      key={pathname}
      className={`w-full my-6 flex justify-center items-center ${className}`}
      style={{ minHeight }}
    >
      <ins
        ref={insRef}
        className="adsbygoogle"
        style={{ display: "block", width: "100%", minHeight }}
        data-ad-client={AD_CLIENT}
        data-ad-slot={slot}
        data-ad-format="auto"
        data-full-width-responsive="true"
      />
    </div>
  )
}
