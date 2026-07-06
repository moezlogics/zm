"use client"

import { useEffect } from "react"

const AD_CLIENT = "ca-pub-8616277671572207"

let loadPromise: Promise<void> | null = null

/**
 * Load the AdSense script once, after the page is interactive.
 * Pushes queued in `window.adsbygoogle` drain automatically once loaded.
 */
export function ensureAdSenseLoaded(client: string = AD_CLIENT): Promise<void> {
  if (typeof window === "undefined") return Promise.resolve()
  const w = window as Window & { __adsenseLoaded?: boolean }
  if (w.__adsenseLoaded) return Promise.resolve()
  if (document.querySelector(`script[src*="adsbygoogle.js"][src*="${client}"]`)) {
    w.__adsenseLoaded = true
    return Promise.resolve()
  }
  if (!loadPromise) {
    loadPromise = new Promise((resolve, reject) => {
      const s = document.createElement("script")
      s.async = true
      s.src = `https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${client}`
      s.crossOrigin = "anonymous"
      s.onload = () => {
        w.__adsenseLoaded = true
        // #region agent log
        fetch("http://127.0.0.1:7489/ingest/fc89e651-bfd9-4ece-8a01-30fee9370848", {
          method: "POST",
          headers: { "Content-Type": "application/json", "X-Debug-Session-Id": "90b8a9" },
          body: JSON.stringify({
            sessionId: "90b8a9",
            runId: "lcp-fix",
            hypothesisId: "H3-adsense",
            location: "adsense-loader.tsx",
            message: "AdSense script loaded (deferred)",
            data: { client: client.slice(0, 12) },
            timestamp: Date.now(),
          }),
        }).catch(() => {})
        // #endregion
        resolve()
      }
      s.onerror = () => reject(new Error("AdSense script failed to load"))
      document.head.appendChild(s)
    })
  }
  return loadPromise
}

/**
 * Schedules AdSense loader after first paint + idle time so it never
 * blocks LCP. GoogleAd still queues pushes before the loader finishes.
 */
export default function AdSenseDeferredLoader() {
  useEffect(() => {
    const run = () => {
      ensureAdSenseLoaded().catch(() => {})
    }
    if ("requestIdleCallback" in window) {
      const id = requestIdleCallback(run, { timeout: 3500 })
      return () => cancelIdleCallback(id)
    }
    const t = setTimeout(run, 2000)
    return () => clearTimeout(t)
  }, [])
  return null
}
