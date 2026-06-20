"use client"

import { useEffect } from "react"
import Script from "next/script"

/**
 * GoogleAd component integrates Google AdSense responsive ad slots.
 * It is fully optimized using Next.js next/script with lazyOnload strategy
 * so it doesn't block the initial page loading, rendering and interactivity.
 */
export default function GoogleAd() {
  useEffect(() => {
    // Avoid executing during SSR or if window is not available
    if (typeof window !== "undefined") {
      try {
        // Initialize the ad slot
        const adsbygoogle = (window as any).adsbygoogle || []
        adsbygoogle.push({})
      } catch (err) {
        console.error("AdSense push error:", err)
      }
    }
  }, [])

  return (
    <div className="w-full my-4 flex justify-center items-center overflow-hidden min-h-[100px] bg-bg/5 rounded-lg border border-line/10 select-none">
      <Script
        id="adsbygoogle-init"
        src="https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=ca-pub-8616277671572207"
        strategy="lazyOnload"
        crossOrigin="anonymous"
      />
      <ins
        className="adsbygoogle"
        style={{ display: "block", width: "100%" }}
        data-ad-client="ca-pub-8616277671572207"
        data-ad-slot="6428686902"
        data-ad-format="auto"
        data-full-width-responsive="true"
      />
    </div>
  )
}
