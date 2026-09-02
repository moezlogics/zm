"use client"

const AD_CLIENT = "ca-pub-2571706004681433"

let loadPromise: Promise<void> | null = null

/** Load AdSense once — only called from GoogleAd when the slot is near viewport. */
export function ensureAdSenseLoaded(client: string = AD_CLIENT): Promise<void> {
  if (typeof window === "undefined") return Promise.resolve()
  const w = window as Window & { __adsenseLoaded?: boolean; adsbygoogle?: unknown[] }
  w.adsbygoogle = w.adsbygoogle || []
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
        resolve()
      }
      s.onerror = (e) => {
        loadPromise = null
        console.warn("AdSense script failed to load:", e)
        reject(new Error("AdSense script failed to load"))
      }
      document.head.appendChild(s)
    })
  }
  return loadPromise
}

/** Wait until the document finished its initial load (tab spinner done or interactive). */
export function whenPageLoaded(): Promise<void> {
  if (typeof window === "undefined") return Promise.resolve()
  if (document.readyState === "complete" || document.readyState === "interactive") {
    return Promise.resolve()
  }
  return new Promise((resolve) => {
    const done = () => resolve()
    if (document.readyState !== "loading") {
      resolve()
      return
    }
    window.addEventListener("DOMContentLoaded", done, { once: true })
    window.addEventListener("load", done, { once: true })
    // Safety fallback: never hang longer than 800ms
    setTimeout(done, 800)
  })
}
