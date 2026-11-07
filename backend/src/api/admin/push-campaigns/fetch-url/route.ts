import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { lookup } from "dns/promises"
import net from "net"

/**
 * POST /admin/push-campaigns/fetch-url   { url }
 *
 * Reads a page and returns what a push needs from it, so the composer can
 * fill itself in:
 *   title  — og:title → twitter:title → product JSON-LD name → <title>
 *   body   — og/meta description → JSON-LD description → first paragraph,
 *            cut to one or two sentences; product price prepended when known
 *   image  — og:image → twitter:image → JSON-LD image (absolute URL)
 *   url    — canonical URL (falls back to the final URL after redirects)
 *
 * Guard rails: http(s) only, no private/loopback addresses, 8s timeout,
 * at most 1.5 MB read.
 */
const MAX_BYTES = 1_500_000
const TIMEOUT_MS = 8000

function isPrivateIp(ip: string): boolean {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split(".").map(Number)
    return (
      a === 10 || a === 127 || a === 0 ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 100 && b >= 64 && b <= 127)
    )
  }
  const v = ip.toLowerCase()
  return v === "::1" || v === "::" || v.startsWith("fc") || v.startsWith("fd") || v.startsWith("fe80") ||
    (v.startsWith("::ffff:") && isPrivateIp(v.slice(7)))
}

const decode = (s: string) =>
  (s || "")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&nbsp;/g, " ")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")

const clean = (s: string) =>
  decode(String(s || "").replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim()

function parseAttrs(tag: string): Record<string, string> {
  const out: Record<string, string> = {}
  const re = /([a-zA-Z_:.-]+)\s*=\s*("([^"]*)"|'([^']*)'|([^\s"'>]+))/g
  let m: RegExpExecArray | null
  while ((m = re.exec(tag))) out[m[1].toLowerCase()] = m[3] ?? m[4] ?? m[5] ?? ""
  return out
}

/** One or two sentences, at most `max` characters, cut at a word. */
function excerpt(text: string, max = 170): string {
  const t = clean(text)
  if (t.length <= max) return t
  const sentences = t.match(/[^.!?।]+[.!?।]+(\s|$)/g) || []
  let out = ""
  for (const s of sentences) {
    if ((out + s).trim().length > max) break
    out += s
  }
  out = out.trim()
  if (out.length >= 40) return out
  return t.slice(0, max).replace(/\s+\S*$/, "") + "…"
}

function findProductLd(html: string): any | null {
  const blocks = html.match(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi) || []
  for (const block of blocks) {
    const json = block.replace(/^<script[^>]*>/i, "").replace(/<\/script>$/i, "")
    try {
      const parsed = JSON.parse(json)
      const items: any[] = Array.isArray(parsed) ? parsed : parsed?.["@graph"] || [parsed]
      for (const it of items) {
        const type = it?.["@type"]
        if (type === "Product" || (Array.isArray(type) && type.includes("Product"))) return it
      }
    } catch {
      /* skip broken blocks */
    }
  }
  return null
}

function ldPrice(ld: any): string {
  const offers = Array.isArray(ld?.offers) ? ld.offers[0] : ld?.offers
  const amount = offers?.lowPrice ?? offers?.price
  const currency = String(offers?.priceCurrency || "").toUpperCase()
  const n = Number(amount)
  if (!Number.isFinite(n) || n <= 0) return ""
  return currency === "PKR" || !currency
    ? `Rs ${Math.round(n).toLocaleString("en-PK")}`
    : `${n.toLocaleString("en-US")} ${currency}`
}

export async function POST(req: MedusaRequest, res: MedusaResponse) {
  const raw = String(((req.body || {}) as any).url || "").trim()
  let url: URL
  try {
    url = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`)
  } catch {
    return res.status(400).json({ error: "That doesn't look like a valid URL." })
  }
  if (!/^https?:$/.test(url.protocol)) {
    return res.status(400).json({ error: "Only http(s) links are supported." })
  }
  try {
    const { address } = await lookup(url.hostname)
    if (isPrivateIp(address)) return res.status(400).json({ error: "Private addresses are not allowed." })
  } catch {
    return res.status(400).json({ error: `Couldn't resolve ${url.hostname}.` })
  }

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
  let html = ""
  let finalUrl = url.toString()
  try {
    const r = await fetch(url, {
      redirect: "follow",
      signal: controller.signal,
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; PushComposer/1.0; +link-preview)",
        Accept: "text/html,application/xhtml+xml",
      },
    })
    finalUrl = r.url || finalUrl
    if (!r.ok) return res.status(422).json({ error: `The page answered ${r.status}.` })
    const type = r.headers.get("content-type") || ""
    if (!/html|xml/i.test(type)) return res.status(422).json({ error: "That link isn't a web page." })

    const reader = r.body?.getReader()
    const chunks: Uint8Array[] = []
    let size = 0
    if (reader) {
      for (;;) {
        const { done, value } = await reader.read()
        if (done || !value) break
        chunks.push(value)
        size += value.length
        if (size >= MAX_BYTES) {
          controller.abort()
          break
        }
      }
    }
    html = Buffer.concat(chunks.map((c) => Buffer.from(c))).toString("utf8")
  } catch (e: any) {
    if (!html) {
      return res.status(422).json({
        error: e?.name === "AbortError" ? "The page took too long to answer." : `Couldn't open the page: ${e?.message || e}`,
      })
    }
  } finally {
    clearTimeout(timer)
  }

  const head = html.slice(0, 400_000)
  const meta: Record<string, string> = {}
  for (const tag of head.match(/<meta\b[^>]*>/gi) || []) {
    const a = parseAttrs(tag)
    const key = (a.property || a.name || a.itemprop || "").toLowerCase()
    if (key && a.content && !meta[key]) meta[key] = decode(a.content).trim()
  }
  let canonical = ""
  for (const tag of head.match(/<link\b[^>]*>/gi) || []) {
    const a = parseAttrs(tag)
    if ((a.rel || "").toLowerCase() === "canonical" && a.href) canonical = a.href
  }
  const docTitle = clean(head.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || "")
  const firstPara = clean(
    (html.match(/<p\b[^>]*>([\s\S]*?)<\/p>/gi) || []).map((p) => clean(p)).find((t) => t.length > 60) || ""
  )
  const ld = findProductLd(html)

  const abs = (u: string) => {
    try {
      return u ? new URL(decode(u), finalUrl).toString() : ""
    } catch {
      return ""
    }
  }

  let title =
    meta["og:title"] || meta["twitter:title"] || clean(ld?.name || "") || docTitle
  const siteName = meta["og:site_name"] || ""
  // "Product name | Store" → "Product name"
  if (siteName && title.endsWith(siteName)) title = title.slice(0, -siteName.length).replace(/[\s|–—-]+$/, "")
  title = clean(title).slice(0, 80)

  const description =
    meta["og:description"] || meta["description"] || meta["twitter:description"] || clean(ld?.description || "") || firstPara
  const price = ldPrice(ld) || (meta["product:price:amount"] ? `Rs ${Number(meta["product:price:amount"]).toLocaleString("en-PK")}` : "")
  let body = excerpt(description, price ? 150 : 170)
  if (price && !body.includes(price.replace("Rs ", ""))) body = body ? `${price} · ${body}` : price

  const ldImage = Array.isArray(ld?.image) ? ld.image[0] : ld?.image?.url || ld?.image
  const image = abs(meta["og:image"] || meta["og:image:url"] || meta["twitter:image"] || (typeof ldImage === "string" ? ldImage : ""))

  if (!title && !body && !image) {
    return res.status(422).json({ error: "No title, description or image found on that page." })
  }

  res.json({
    title,
    body,
    image,
    url: abs(canonical) || finalUrl,
    site_name: siteName,
    price,
  })
}
