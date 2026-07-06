"use client"

import dynamic from "next/dynamic"

const GoogleAd = dynamic(() => import("./index"), { ssr: false })

type LazyGoogleAdProps = {
  slot?: string
  minHeight?: number
  className?: string
}

/** Client-only AdSense slot — safe to import from Server Components. */
export default function LazyGoogleAd(props: LazyGoogleAdProps) {
  return <GoogleAd {...props} />
}
