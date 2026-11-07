import { generateEntityId } from "@medusajs/framework/utils"
import { PUSH_NOTIFICATIONS_MODULE } from ".."
import { SITE_SETTINGS_MODULE } from "../../site-settings"
import {
  buildPayload,
  countAudience,
  enqueueSend,
  getPushContext,
  runCampaignSend,
  slugify,
  withUtm,
} from "./campaign-engine"
import { configureWebPush } from "./web-push-client"

/**
 * New-product auto push.
 *
 * Subscribers are split into N groups (stable hash of their id). Every
 * time a product is published for the first time, ONE group gets a push
 * about it, and the next product goes to the next group:
 *
 *   product 1 → group 1, product 2 → group 2, … product 11 → group 1 …
 *
 * so each subscriber hears about roughly one product in N, whatever the
 * list size. Rules:
 *  - only products (status "published"), never drafts, never blog posts
 *  - each product is pushed at most once (unique row in push_auto_log)
 *  - products already published when the feature is switched on are
 *    recorded as "baseline" and never pushed
 *  - a group that got an auto push less than `cooldown_hours` ago is not
 *    pushed again; that product is logged as skipped
 *  - optional quiet hours (Pakistan time) skip pushes at night
 *
 * Settings live in site_settings (push_auto_*), edited on Admin →
 * Push → Auto Push.
 */

export const AUTO_KEYS = {
  enabled: "push_auto_enabled",
  partitions: "push_auto_partitions",
  cooldown: "push_auto_cooldown_hours",
  quietStart: "push_auto_quiet_start",
  quietEnd: "push_auto_quiet_end",
  titleTpl: "push_auto_title_template",
  bodyTpl: "push_auto_body_template",
  requireImage: "push_auto_require_image",
  utm: "push_auto_utm",
  baselineAt: "push_auto_baseline_at",
} as const

export type AutoSettings = {
  enabled: boolean
  partitions: number
  cooldown_hours: number
  quiet_start: number | null
  quiet_end: number | null
  title_template: string
  body_template: string
  require_image: boolean
  utm: boolean
  baseline_at: string | null
}

export const AUTO_DEFAULTS: AutoSettings = {
  enabled: false,
  partitions: 10,
  cooldown_hours: 6,
  quiet_start: null,
  quiet_end: null,
  title_template: "New arrival: {title}",
  body_template: "{price} · {description}",
  require_image: true,
  utm: true,
  baseline_at: null,
}

const TIMEZONE = "Asia/Karachi"
/** Postgres advisory-lock key for "decide the next auto push". */
const LOCK_KEY = 74_210_611

const clampInt = (v: any, min: number, max: number, dflt: number) => {
  const n = parseInt(String(v ?? ""), 10)
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : dflt
}
const hourOrNull = (v: any) => {
  if (v === null || v === undefined || String(v).trim() === "") return null
  const n = parseInt(String(v), 10)
  return Number.isFinite(n) && n >= 0 && n <= 23 ? n : null
}

export function parseAutoSettings(s: Record<string, any>): AutoSettings {
  return {
    enabled: String(s[AUTO_KEYS.enabled] ?? "") === "true",
    partitions: clampInt(s[AUTO_KEYS.partitions], 1, 50, AUTO_DEFAULTS.partitions),
    cooldown_hours: clampInt(s[AUTO_KEYS.cooldown], 0, 168, AUTO_DEFAULTS.cooldown_hours),
    quiet_start: hourOrNull(s[AUTO_KEYS.quietStart]),
    quiet_end: hourOrNull(s[AUTO_KEYS.quietEnd]),
    title_template: String(s[AUTO_KEYS.titleTpl] ?? "").trim() || AUTO_DEFAULTS.title_template,
    body_template: String(s[AUTO_KEYS.bodyTpl] ?? "").trim() || AUTO_DEFAULTS.body_template,
    require_image: String(s[AUTO_KEYS.requireImage] ?? "true") !== "false",
    utm: String(s[AUTO_KEYS.utm] ?? "true") !== "false",
    baseline_at: s[AUTO_KEYS.baselineAt] || null,
  }
}

export function toSettingsRecord(a: AutoSettings): Record<string, string> {
  return {
    [AUTO_KEYS.enabled]: a.enabled ? "true" : "false",
    [AUTO_KEYS.partitions]: String(a.partitions),
    [AUTO_KEYS.cooldown]: String(a.cooldown_hours),
    [AUTO_KEYS.quietStart]: a.quiet_start === null ? "" : String(a.quiet_start),
    [AUTO_KEYS.quietEnd]: a.quiet_end === null ? "" : String(a.quiet_end),
    [AUTO_KEYS.titleTpl]: a.title_template,
    [AUTO_KEYS.bodyTpl]: a.body_template,
    [AUTO_KEYS.requireImage]: a.require_image ? "true" : "false",
    [AUTO_KEYS.utm]: a.utm ? "true" : "false",
  }
}

export function getPg(container: any): any {
  return container.resolve("__pg_connection__")
}

/**
 * Record every currently published product as "baseline" so it is never
 * auto-pushed. Run whenever auto push is switched on (products published
 * while it was off are added then). One INSERT … SELECT, no app memory.
 */
export async function runBaseline(container: any): Promise<number> {
  const pg = getPg(container)
  const r = await pg.raw(
    `INSERT INTO push_auto_log (id, product_id, product_title, status, reason, created_at, updated_at)
     SELECT 'pauto_' || md5(random()::text || p.id), p.id, p.title, 'baseline',
            'Already published when auto push was switched on', now(), now()
     FROM product p
     WHERE p.status = 'published' AND p.deleted_at IS NULL
     ON CONFLICT DO NOTHING`
  )
  await container.resolve(SITE_SETTINGS_MODULE).bulkUpsert({
    [AUTO_KEYS.baselineAt]: new Date().toISOString(),
  })
  return Number(r?.rowCount || 0)
}

/* ------------------------------------------------------------------ */
/* Product → notification text                                          */
/* ------------------------------------------------------------------ */

export type ProductInfo = {
  id: string
  title: string
  handle: string
  status: string
  thumbnail: string | null
  description: string
  price: string
  category: string
  path: string
}

const stripHtml = (html: string) =>
  (html || "")
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim()

/** First sentence (or the first `max` characters, cut at a word). */
export function firstLine(text: string, max = 120): string {
  const t = stripHtml(text)
  if (!t) return ""
  const sentence = t.match(/^.{20,}?[.!?।](\s|$)/)?.[0]?.trim() || t
  if (sentence.length <= max) return sentence
  return sentence.slice(0, max).replace(/\s+\S*$/, "") + "…"
}

export async function loadProduct(container: any, productId: string): Promise<ProductInfo | null> {
  const query = container.resolve("query")
  const { data } = await query.graph({
    entity: "product",
    fields: [
      "id",
      "title",
      "handle",
      "status",
      "subtitle",
      "description",
      "thumbnail",
      "images.url",
      "categories.name",
      "categories.handle",
      "categories.parent_category.handle",
      "categories.parent_category.parent_category.handle",
      "variants.prices.amount",
      "variants.prices.currency_code",
    ],
    filters: { id: productId },
  })
  const p: any = data?.[0]
  if (!p) return null

  const prices: { amount: number; currency_code: string }[] = (p.variants || [])
    .flatMap((v: any) => v.prices || [])
    .filter((x: any) => x && Number(x.amount) > 0)
  const pkr = prices.filter((x) => String(x.currency_code).toLowerCase() === "pkr")
  const pool = pkr.length ? pkr : prices
  let price = ""
  if (pool.length) {
    const min = pool.reduce((a, b) => (Number(b.amount) < Number(a.amount) ? b : a))
    const n = Number(min.amount)
    price =
      String(min.currency_code).toLowerCase() === "pkr"
        ? `Rs ${Math.round(n).toLocaleString("en-PK")}`
        : `${n.toLocaleString("en-US")} ${String(min.currency_code).toUpperCase()}`
  }

  // Same path the storefront uses: /<parent>/<category>/<handle>
  const cat = p.categories?.[0]
  const segs: string[] = []
  if (cat?.handle) {
    let c: any = cat
    while (c && c.handle) {
      segs.unshift(c.handle)
      c = c.parent_category
    }
  }
  segs.push(p.handle)

  return {
    id: p.id,
    title: String(p.title || "").trim(),
    handle: p.handle,
    status: p.status,
    thumbnail: p.thumbnail || p.images?.[0]?.url || null,
    description: firstLine(p.subtitle || p.description || ""),
    price,
    category: cat?.name || "",
    path: "/" + segs.join("/"),
  }
}

/** Fill {title} {price} {description} {category} {site}; tidy empty parts. */
export function renderTemplate(tpl: string, p: ProductInfo, siteName: string): string {
  const out = tpl
    .replace(/\{title\}/g, p.title)
    .replace(/\{price\}/g, p.price)
    .replace(/\{description\}/g, p.description)
    .replace(/\{category\}/g, p.category)
    .replace(/\{site\}/g, siteName)
  return out
    .replace(/(\s*[·|•–—-]\s*){2,}/g, " · ")
    .replace(/^\s*[·|•–—-]\s*|\s*[·|•–—-]\s*$/g, "")
    .replace(/\s{2,}/g, " ")
    .trim()
}

function hourInPakistan(d = new Date()): number {
  return Number(
    new Intl.DateTimeFormat("en-GB", { hour: "numeric", hour12: false, timeZone: TIMEZONE }).format(d)
  ) % 24
}

export function inQuietHours(a: AutoSettings, d = new Date()): boolean {
  if (a.quiet_start === null || a.quiet_end === null || a.quiet_start === a.quiet_end) return false
  const h = hourInPakistan(d)
  return a.quiet_start < a.quiet_end
    ? h >= a.quiet_start && h < a.quiet_end
    : h >= a.quiet_start || h < a.quiet_end // e.g. 23 → 9 wraps midnight
}

/** Next group after the last auto push (0-based). */
export async function nextPartition(pg: any, total: number): Promise<number> {
  const r = await pg.raw(
    `SELECT partition_index FROM push_auto_log
     WHERE status = 'sent' AND deleted_at IS NULL AND partition_index IS NOT NULL
     ORDER BY created_at DESC LIMIT 1`
  )
  const last = r?.rows?.[0]?.partition_index
  return last === undefined || last === null ? 0 : (Number(last) + 1) % total
}

/* ------------------------------------------------------------------ */
/* Event entry point                                                    */
/* ------------------------------------------------------------------ */

/**
 * Called on product.created / product.updated. Cheap when there's nothing
 * to do: one settings read (cached) and one indexed lookup.
 */
export async function handleProductEvent(container: any, productId: string): Promise<void> {
  const logger = container.resolve("logger")
  const ctx = await getPushContext(container)
  const auto = parseAutoSettings(ctx.settings)
  if (!auto.enabled || !productId) return

  const pg = getPg(container)
  if (!auto.baseline_at) {
    // The cached settings may predate the admin switching it on (which
    // records the baseline) — check fresh before doing anything.
    const fresh = parseAutoSettings((await getPushContext(container, true)).settings)
    if (fresh.baseline_at) return handleProductEvent(container, productId)
    if (!fresh.enabled) return
    // Switched on without going through the admin page: record what's
    // already published first, and push nothing this time.
    await runBaseline(container)
    return
  }

  const seen = await pg.raw(
    `SELECT 1 FROM push_auto_log WHERE product_id = ? AND deleted_at IS NULL LIMIT 1`,
    [productId]
  )
  if (seen?.rows?.length) return

  const product = await loadProduct(container, productId)
  if (!product || product.status !== "published") return // drafts wait until published

  if (!configureWebPush().configured) {
    logger.warn("[AutoPush] VAPID keys missing — auto push skipped")
    return
  }

  // Decide under a database lock so two processes (or two quick events)
  // can't both push, or pick the same group.
  type Decision = { send: false } | { send: true; logId: string; partition: number }
  const decision: Decision = await pg.transaction(async (trx: any) => {
    await trx.raw(`SELECT pg_advisory_xact_lock(?)`, [LOCK_KEY])
    const again = await trx.raw(
      `SELECT 1 FROM push_auto_log WHERE product_id = ? AND deleted_at IS NULL LIMIT 1`,
      [productId]
    )
    if (again?.rows?.length) return { send: false }

    const record = async (status: string, reason: string | null, partition: number | null) => {
      const id = generateEntityId("", "pauto")
      await trx("push_auto_log").insert({
        id,
        product_id: productId,
        product_title: product.title.slice(0, 250),
        status,
        reason,
        partition_index: partition,
        partitions_total: partition === null ? null : auto.partitions,
        created_at: new Date(),
        updated_at: new Date(),
      })
      return id
    }

    if (auto.require_image && !product.thumbnail) {
      await record("skipped", "Product has no image", null)
      return { send: false }
    }
    if (inQuietHours(auto)) {
      await record("skipped", `Quiet hours (${auto.quiet_start}:00–${auto.quiet_end}:00)`, null)
      return { send: false }
    }

    const partition = await nextPartition(trx, auto.partitions)
    if (auto.cooldown_hours > 0) {
      const recent = await trx.raw(
        `SELECT 1 FROM push_auto_log
         WHERE status = 'sent' AND deleted_at IS NULL AND partition_index = ? AND partitions_total = ?
           AND created_at > now() - (? * interval '1 hour') LIMIT 1`,
        [partition, auto.partitions, auto.cooldown_hours]
      )
      if (recent?.rows?.length) {
        await record(
          "skipped",
          `Group ${partition + 1} already got an auto push in the last ${auto.cooldown_hours}h`,
          null
        )
        return { send: false }
      }
    }
    const logId = await record("sent", null, partition)
    return { send: true, logId, partition }
  })

  if (!decision.send) return
  const { logId, partition } = decision

  const svc: any = container.resolve(PUSH_NOTIFICATIONS_MODULE)
  const filters = { partition: { index: partition, total: auto.partitions } }
  try {
    const targeted = await countAudience(pg, filters)
    const title = renderTemplate(auto.title_template, product, ctx.siteName).slice(0, 120) || product.title
    const body =
      renderTemplate(auto.body_template, product, ctx.siteName).slice(0, 240) ||
      `Now available at ${ctx.siteName}`
    const productUrl = ctx.storefrontUrl + product.path

    const [campaign] = await svc.createPushCampaigns([
      {
        title,
        body,
        icon_url: null,
        image_url: product.thumbnail,
        action_url: productUrl,
        total_targeted: targeted,
        total_sent: 0,
        total_failed: 0,
        status: "sending",
        source: "auto",
        product_id: product.id,
        partition_index: partition,
        partitions_total: auto.partitions,
      },
    ])
    await pg.raw(`UPDATE push_auto_log SET campaign_id = ?, updated_at = now() WHERE id = ?`, [
      campaign.id,
      logId,
    ])

    const payload = buildPayload(ctx, {
      id: campaign.id,
      title,
      body,
      image_url: product.thumbnail,
      action_url: auto.utm ? withUtm(productUrl, `auto-${slugify(product.handle)}`, "web_push_auto") : productUrl,
    })

    logger.info(
      `[AutoPush] "${product.title}" → group ${partition + 1}/${auto.partitions} (${targeted} subscribers)`
    )

    // Not awaited: the event handler returns right away; sends queue up.
    enqueueSend(async () => {
      await runCampaignSend({ container, svc, pg, logger, campaignId: campaign.id, filters, payload })
    }).catch(async (e: any) => {
      logger.error(`[AutoPush] send crashed: ${e?.message || e}`)
      await pg
        .raw(`UPDATE push_auto_log SET status = 'failed', reason = ?, updated_at = now() WHERE id = ?`, [
          String(e?.message || e).slice(0, 300),
          logId,
        ])
        .catch(() => undefined)
      await svc.updatePushCampaigns({ id: campaign.id, status: "failed", sent_at: new Date() }).catch(() => undefined)
    })
  } catch (e: any) {
    logger.error(`[AutoPush] could not start push for ${productId}: ${e?.message || e}`)
    await pg
      .raw(`UPDATE push_auto_log SET status = 'failed', reason = ?, updated_at = now() WHERE id = ?`, [
        String(e?.message || e).slice(0, 300),
        logId,
      ])
      .catch(() => undefined)
  }
}
