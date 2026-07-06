"use client"

import { useEffect } from "react"

const AD_CLIENT = "ca-pub-8616277671572207"

let loadPromise: Promise<void> | null = null

/** Load AdSense once — only called from GoogleAd when the slot is near viewport. */
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
        resolve()
      }
      s.onerror = () => reject(new Error("AdSense script failed to load"))
      document.head.appendChild(s)
    })
  }
  return loadPromise
}

/** Wait until the document finished its initial load (tab spinner done). */
export function whenPageLoaded(): Promise<void> {
  if (typeof window === "undefined") return Promise.resolve()
  if (document.readyState === "complete") return Promise.resolve()
  return new Promise((resolve) => {
    window.addEventListener("load", () => resolve(), { once: true })
  })
}
