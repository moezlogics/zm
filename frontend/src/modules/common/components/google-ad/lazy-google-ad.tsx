"use client"

import dynamic from "next/dynamic"

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * MASTER ADSENSE SWITCH
 * Set to `true` to enable ads across the entire site, or `false` to disable.
 * ─────────────────────────────────────────────────────────────────────────────
 */
export const ADS_ENABLED = true

const GoogleAd = dynamic(() => import("./index"), { ssr: false })

type LazyGoogleAdProps = {
  slot?: string
  minHeight?: number
  className?: string
}

/** Client-only AdSense slot — safe to import from Server Components. */
export default function LazyGoogleAd(props: LazyGoogleAdProps) {
  if (!ADS_ENABLED) return null
  return <GoogleAd {...props} />
}
