"use client"

import { useEffect, useRef } from "react"
import { usePathname } from "next/navigation"
import { ensureAdSenseLoaded, whenPageLoaded } from "@modules/analytics/adsense-loader"

type GoogleAdProps = {
  slot?: string
  minHeight?: number
  className?: string
}

const AD_CLIENT = "ca-pub-8616277671572207"
const DEFAULT_SLOT = "6428686902"

/**
 * AdSense slot — loads ONLY after:
 *   1. document `load` (browser tab spinner finished)
 *   2. slot is near the viewport (IntersectionObserver)
 * Then pushes to `window.adsbygoogle` so impressions still register.
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
        if (tries++ < 25) timer = setTimeout(tryFill, 150)
        return
      }
      try {
        const w = window as Window & { adsbygoogle?: unknown[] }
        ;(w.adsbygoogle = w.adsbygoogle || []).push({})
        pushed.current = true
      } catch {
        if (tries++ < 25) timer = setTimeout(tryFill, 200)
      }
    }

    const startFill = () => {
      whenPageLoaded()
        .then(() => ensureAdSenseLoaded(AD_CLIENT))
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
        { rootMargin: "320px 0px" }
      )
      observer.observe(wrapper)
    } else {
      timer = setTimeout(startFill, 500)
    }

    return () => {
      cancelled = true
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
