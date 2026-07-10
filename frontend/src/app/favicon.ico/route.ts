import { NextRequest, NextResponse } from "next/server"
import { getSiteSettings } from "@lib/data/site-settings"

export async function GET(request: NextRequest) {
  const settings = await getSiteSettings()
  const faviconUrl = settings.site_favicon_url?.trim()

  if (faviconUrl) {
    try {
      // Ensure absolute URL (NextResponse.redirect requires an absolute URL)
      const absoluteUrl = new URL(faviconUrl, request.url).toString()
      return NextResponse.redirect(absoluteUrl, 302)
    } catch (e) {
      console.error("[FaviconRoute] Failed to parse favicon URL:", faviconUrl, e)
    }
  }

  // If no admin-configured favicon exists, return a 404
  return new NextResponse(null, { status: 404 })
}
