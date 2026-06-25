"use client"

import { useEffect, useRef } from "react"
import { usePathname } from "next/navigation"

/**
 * GoogleAd component integrates Google AdSense responsive ad slots.
 * Refactored to prevent duplicate initialization errors and support
 * smooth reloading across Next.js client-side route transitions.
 */
export default function GoogleAd() {
  const pathname = usePathname()
  const initialized = useRef(false)

  useEffect(() => {
    // Reset the local initialization tracker for this mount cycle
    initialized.current = false

    // Wait for the Next.js page transition to settle and the DOM to paint
    const timer = setTimeout(() => {
      if (typeof window !== "undefined" && !initialized.current) {
        try {
          const adsbygoogle = (window as any).adsbygoogle || []
          
          // Verify if there are uninitialized ad slots in the DOM
          // before pushing to prevent Google AdSense duplication errors.
          const uninitializedAds = document.querySelectorAll(
            'ins.adsbygoogle:not([data-adsbygoogle-status="done"])'
          )
          
          if (uninitializedAds.length > 0) {
            adsbygoogle.push({})
            initialized.current = true
          }
        } catch (err) {
          console.error("AdSense push error:", err)
        }
      }
    }, 100)

    return () => {
      clearTimeout(timer)
    }
  }, [pathname])

  return (
    <div
      key={pathname}
      className="w-full my-6 flex justify-center items-center overflow-hidden min-h-[100px] select-none"
    >
      <ins
        className="adsbygoogle"
        style={{ display: "block", width: "100%", minHeight: "100px" }}
        data-ad-client="ca-pub-8616277671572207"
        data-ad-slot="6428686902"
        data-ad-format="auto"
        data-full-width-responsive="true"
      />
    </div>
  )
}
