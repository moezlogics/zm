"use client"

import { useEffect, useRef } from "react"
import { usePathname } from "next/navigation"
import { ensureAdSenseLoaded, whenPageLoaded } from "@modules/analytics/adsense-loader"
import { ADS_ENABLED } from "./lazy-google-ad"

type GoogleAdProps = {
  slot?: string
  minHeight?: number
  className?: string
}

const AD_CLIENT = "ca-pub-8616277671572207"
const DEFAULT_SLOT = "6428686902"

/**
 * AdSense slot — loads seamlessly with fallback:
 *   1. document interactive / loaded
 *   2. slot is near the viewport (IntersectionObserver with 400px margin or fallback timer)
 * Then safely pushes to `window.adsbygoogle`.
 */
export default function GoogleAd({
  slot = DEFAULT_SLOT,
  minHeight = 90,
  className = "",
}: GoogleAdProps) {
  if (!ADS_ENABLED) return null
  const pathname = usePathname()
  const insRef = useRef<HTMLModElement | null>(null)
  const pushed = useRef(false)

  useEffect(() => {
    pushed.current = false
    let tries = 0
    let timer: ReturnType<typeof setTimeout> | undefined
    let observer: IntersectionObserver | undefined
    let cancelled = false

    const tryFill = () => {
      if (cancelled) return
      const ins = insRef.current
      if (!ins || pushed.current) return
      if (ins.getAttribute("data-adsbygoogle-status") === "done") {
        pushed.current = true
        return
      }
      if (ins.getBoundingClientRect().width === 0) {
        if (tries++ < 30) timer = setTimeout(tryFill, 100)
        return
      }
      try {
        const w = window as Window & { adsbygoogle?: unknown[] }
        w.adsbygoogle = w.adsbygoogle || []
        w.adsbygoogle.push({})
        pushed.current = true
      } catch (err) {
        console.warn("adsbygoogle push error:", err)
        if (tries++ < 30) timer = setTimeout(tryFill, 200)
      }
    }

    const startFill = () => {
      whenPageLoaded()
        .then(() => ensureAdSenseLoaded(AD_CLIENT))
        .then(() => tryFill())
        .catch(() => {
          if (tries++ < 30) timer = setTimeout(tryFill, 250)
        })
    }

    const wrapper = insRef.current?.parentElement
    if (wrapper && typeof window !== "undefined" && "IntersectionObserver" in window) {
      observer = new IntersectionObserver(
        (entries) => {
          if (entries.some((e) => e.isIntersecting)) {
            observer?.disconnect()
            startFill()
          }
        },
        { rootMargin: "400px 0px" }
      )
      observer.observe(wrapper)
      // Safety timeout: if IntersectionObserver doesn't fire within 1.2s, start fill anyway
      timer = setTimeout(startFill, 1200)
    } else {
      timer = setTimeout(startFill, 300)
    }

    return () => {
      cancelled = true
      observer?.disconnect()
      if (timer) clearTimeout(timer)
    }
  }, [pathname, slot])

  return (
    <div
      className={`w-full my-4 md:my-6 flex justify-center items-center overflow-hidden ${className}`}
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
