import { generateEntityId } from "@medusajs/framework/utils"
import { PUSH_NOTIFICATIONS_MODULE } from ".."
import { SITE_SETTINGS_MODULE } from "../../site-settings"
import { sendPushBatch, type PushSubscriptionLite } from "./web-push-client"

/**
 * Shared campaign engine — used by the manual composer and the
 * new-product auto push.
 *
 * Built to keep the server light at any list size:
 *  - The audience is filtered and counted IN SQL (indexed columns), never
 *    by loading every subscriber into Node.
 *  - Recipients are read in pages of PAGE_SIZE ordered by id (keyset
 *    pagination), sent, logged and released before the next page, so
 *    memory stays flat for 1k or 10M subscribers.
 *  - Delivery rows are bulk-inserted per page; bookkeeping is one UPDATE
 *    per page.
 *  - Campaigns run one at a time per process (a small queue), so two big
 *    sends never double the outgoing connections.
 */

export const PAGE_SIZE = 1000
const CANARY_SIZE = 25
const SEND_CONCURRENCY = 20

/* ------------------------------------------------------------------ */
/* Audience                                                            */
/* ------------------------------------------------------------------ */

export type AudienceFilters = {
  cities?: string[] | null
  states?: string[] | null
  countries?: string[] | null
  device_types?: string[] | null
  os?: string[] | null
  browsers?: string[] | null
  genders?: string[] | null
  customers_only?: boolean
  /** Subscriber group: `index` of `total` (stable hash of the id). */
  partition?: { index: number; total: number } | null
}

const FILTER_COLUMNS: [keyof AudienceFilters, string][] = [
  ["cities", "city"],
  ["states", "state"],
  ["countries", "country"],
  ["device_types", "device_type"],
  ["os", "os"],
  ["browsers", "device_browser"],
  ["genders", "gender"],
]

/**
 * Group number of a subscriber, 0..total-1. hashtext() is stable for the
 * same id, so a subscriber always stays in the same group (for the same
 * group count) and groups come out even. Shifted into bigint so abs() of
 * the smallest int4 can't overflow.
 */
export const PARTITION_SQL = `mod(hashtext(id)::bigint + 2147483648, ?)`

export function audienceWhere(f: AudienceFilters): { sql: string; bindings: any[] } {
  const parts = [`deleted_at IS NULL`, `is_active = true`]
  const bindings: any[] = []
  for (const [key, column] of FILTER_COLUMNS) {
    const list = (f[key] as string[] | null | undefined)?.filter(Boolean)
    if (list && list.length) {
      parts.push(`lower(${column}) = ANY(?)`)
      bindings.push(list.map((v) => String(v).toLowerCase()))
    }
  }
  if (f.customers_only) parts.push(`customer_id IS NOT NULL`)
  if (f.partition && f.partition.total > 1) {
    parts.push(`${PARTITION_SQL} = ?`)
    bindings.push(f.partition.total, f.partition.index)
  }
  return { sql: parts.join(" AND "), bindings }
}

export async function countAudience(pg: any, f: AudienceFilters): Promise<number> {
  const w = audienceWhere(f)
  const r = await pg.raw(`SELECT count(*)::int AS n FROM push_subscription WHERE ${w.sql}`, w.bindings)
  return Number(r?.rows?.[0]?.n || 0)
}

/** Subscribers per group, in one pass. */
export async function partitionSizes(pg: any, total: number): Promise<number[]> {
  const sizes = Array.from({ length: total }, () => 0)
  if (total < 1) return sizes
  const r = await pg.raw(
    `SELECT ${PARTITION_SQL} AS k, count(*)::int AS n FROM push_subscription
     WHERE deleted_at IS NULL AND is_active = true GROUP BY 1`,
    [total]
  )
  for (const row of r?.rows || []) sizes[Number(row.k)] = Number(row.n)
  return sizes
}

/* ------------------------------------------------------------------ */
/* Defaults: site icon, storefront URL, publishable key                 */
/* ------------------------------------------------------------------ */

export type PushContext = {
  storefrontUrl: string
  siteName: string
  defaultIcon: string
  backendUrl?: string
  publishableKey?: string
  settings: Record<string, string>
}

let ctxCache: { at: number; value: PushContext } | null = null

/**
 * Everything a payload needs that doesn't change per campaign. Cached for
 * a minute so a burst of auto pushes doesn't re-read settings each time.
 */
export async function getPushContext(container: any, fresh = false): Promise<PushContext> {
  if (!fresh && ctxCache && Date.now() - ctxCache.at < 60_000) return ctxCache.value

  let settings: Record<string, string> = {}
  try {
    settings = await container.resolve(SITE_SETTINGS_MODULE).getAll()
  } catch {
    /* settings module unavailable → env defaults */
  }

  const storefrontUrl = (
    process.env.STOREFRONT_URL ||
    settings.site_url ||
    "https://zmobiles.pk"
  ).replace(/\/+$/, "")

  const icon =
    settings.push_default_icon_url?.trim() ||
    settings.site_favicon_url?.trim() ||
    "/favicon.ico"

  // The SW posts shown/click events to the store API, which only accepts
  // a publishable key TOKEN (pk_…). The old code sent the key's id
  // (apk_…), so every tracking call was rejected.
  let publishableKey = process.env.MEDUSA_PUBLISHABLE_KEY || process.env.STORE_PUBLISHABLE_KEY
  if (!publishableKey) {
    try {
      const query = container.resolve("query")
      const { data } = await query.graph({
        entity: "api_key",
        fields: ["id", "token", "type", "revoked_at"],
        filters: { type: "publishable" },
      })
      const live = (data || []).find((k: any) => !k.revoked_at) || data?.[0]
      publishableKey = live?.token || undefined
    } catch {
      /* tracking simply won't post back */
    }
  }

  const value: PushContext = {
    storefrontUrl,
    siteName: settings.site_name?.trim() || "zMobiles",
    defaultIcon: absoluteUrl(icon, storefrontUrl),
    backendUrl:
      process.env.STORE_PUBLIC_BACKEND_URL || process.env.MEDUSA_BACKEND_URL || undefined,
    publishableKey,
    settings,
  }
  ctxCache = { at: Date.now(), value }
  return value
}

export function absoluteUrl(u: string, base: string): string {
  const v = (u || "").trim()
  if (!v) return v
  if (/^https?:\/\//i.test(v)) return v
  if (v.startsWith("//")) return `https:${v}`
  return `${base.replace(/\/+$/, "")}/${v.replace(/^\/+/, "")}`
}

/** Adds utm_* parameters (keeps any the admin already set). */
export function withUtm(url: string, campaign: string, medium = "web_push"): string {
  try {
    const u = new URL(url)
    if (!u.searchParams.has("utm_source")) u.searchParams.set("utm_source", "push")
    if (!u.searchParams.has("utm_medium")) u.searchParams.set("utm_medium", medium)
    if (!u.searchParams.has("utm_campaign")) u.searchParams.set("utm_campaign", campaign)
    return u.toString()
  } catch {
    return url
  }
}

export function slugify(s: string, max = 50): string {
  return (
    (s || "")
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[^\w\s-]/g, "")
      .trim()
      .replace(/[\s_-]+/g, "-")
      .slice(0, max)
      .replace(/-+$/, "") || "push"
  )
}

/** The JSON the service worker receives. */
export function buildPayload(
  ctx: PushContext,
  c: { id: string; title: string; body: string; icon_url?: string | null; image_url?: string | null; action_url?: string | null }
) {
  return {
    title: c.title,
    body: c.body,
    icon: c.icon_url ? absoluteUrl(c.icon_url, ctx.storefrontUrl) : ctx.defaultIcon,
    image: c.image_url ? absoluteUrl(c.image_url, ctx.storefrontUrl) : undefined,
    url: c.action_url ? absoluteUrl(c.action_url, ctx.storefrontUrl) : ctx.storefrontUrl + "/",
    tag: `campaign-${c.id}`,
    backend_url: ctx.backendUrl,
    publishable_key: ctx.publishableKey,
    data: { campaign_id: c.id },
  }
}

/* ------------------------------------------------------------------ */
/* Sending                                                             */
/* ------------------------------------------------------------------ */

let queue: Promise<unknown> = Promise.resolve()

/** Run campaign sends one after another within this process. */
export function enqueueSend(job: () => Promise<void>): Promise<void> {
  const next = queue.then(job, job)
  queue = next.catch(() => undefined)
  return next
}

type Totals = { attempted: number; sent: number; failed: number; breakdown: Record<string, number> }

/**
 * Stream the audience page by page and send. Updates the campaign row
 * after every page so the admin sees progress live.
 */
export async function runCampaignSend({
  container,
  svc: givenSvc,
  pg,
  logger,
  campaignId,
  filters,
  payload,
}: {
  container: any
  /** Pass it when running after the HTTP request has ended. */
  svc?: any
  pg: any
  logger: any
  campaignId: string
  filters: AudienceFilters
  payload: any
}): Promise<Totals> {
  const svc: any = givenSvc || container.resolve(PUSH_NOTIFICATIONS_MODULE)
  const started = Date.now()
  const w = audienceWhere(filters)
  const totals: Totals = { attempted: 0, sent: 0, failed: 0, breakdown: {} }
  let lastId = ""
  let first = true
  let aborted = false

  for (;;) {
    const page = await pg.raw(
      `SELECT id, endpoint, p256dh, auth, customer_id FROM push_subscription
       WHERE ${w.sql} AND id > ? ORDER BY id LIMIT ?`,
      [...w.bindings, lastId, PAGE_SIZE]
    )
    const rows: (PushSubscriptionLite & { id: string })[] = page?.rows || []
    if (!rows.length) break
    lastId = rows[rows.length - 1].id

    let batches: (typeof rows)[] = [rows]
    if (first) {
      // Canary: if not one of the first few is accepted the problem is
      // systemic (VAPID keys, server clock, network) — stop instead of
      // hammering the push service with a whole list.
      batches = [rows.slice(0, CANARY_SIZE), rows.slice(CANARY_SIZE)]
    }

    for (const batch of batches) {
      if (!batch.length) continue
      const outcome = await sendPushBatch(batch, payload, SEND_CONCURRENCY)
      totals.attempted += outcome.total
      totals.sent += outcome.sent
      totals.failed += outcome.failed
      for (const [k, v] of Object.entries(outcome.failureBreakdown)) {
        totals.breakdown[k] = (totals.breakdown[k] || 0) + v
      }
      await recordOutcome(pg, logger, campaignId, outcome, totals.sent > 0)

      if (first && outcome.sent === 0 && outcome.total >= Math.min(CANARY_SIZE, rows.length)) {
        if (rows.length > outcome.total) {
          aborted = true
          logger?.warn?.(
            `[Push ${campaignId}] canary: 0/${outcome.total} accepted, aborting. ` +
              `breakdown=${JSON.stringify(outcome.failureBreakdown)}`
          )
        }
      }
      first = false
      if (aborted) break
    }
    if (aborted) break

    await svc.updatePushCampaigns({
      id: campaignId,
      total_sent: totals.sent,
      total_failed: totals.failed,
    })
    if (rows.length < PAGE_SIZE) break
  }

  await svc.updatePushCampaigns({
    id: campaignId,
    total_sent: totals.sent,
    total_failed: totals.failed,
    status: totals.attempted > 0 && totals.sent === 0 ? "failed" : "sent",
    sent_at: new Date(),
  })

  logger?.info?.(
    `[Push ${campaignId}] done in ${Math.round((Date.now() - started) / 1000)}s: ` +
      `attempted=${totals.attempted} sent=${totals.sent} breakdown=${JSON.stringify(totals.breakdown)}`
  )
  return totals
}

/** Delivery log + subscriber bookkeeping for one batch. */
async function recordOutcome(
  pg: any,
  logger: any,
  campaignId: string,
  outcome: Awaited<ReturnType<typeof sendPushBatch>>,
  channelWorks: boolean
) {
  const now = new Date()
  try {
    const rows = outcome.results.map(({ sub, result: r }) => ({
      id: generateEntityId("", "pdlv"),
      campaign_id: campaignId,
      subscription_id: sub.id || null,
      endpoint: sub.endpoint,
      customer_id: sub.customer_id || null,
      status: r.success ? "sent" : r.kind === "expired" ? "expired" : r.kind === "invalid" ? "invalid" : "failed",
      status_code: r.statusCode ?? null,
      error: r.success ? null : String(r.error || "").slice(0, 500) || null,
      attempts: r.attempts ?? 1,
      created_at: now,
      updated_at: now,
    }))
    for (let i = 0; i < rows.length; i += 500) {
      await pg("push_delivery").insert(rows.slice(i, i + 500))
    }
  } catch (e: any) {
    logger?.warn?.(`[Push ${campaignId}] delivery log write failed: ${e?.message || e}`)
  }

  const run = async (label: string, sql: string, bindings: any[]) => {
    try {
      await pg.raw(sql, bindings)
    } catch (e: any) {
      logger?.warn?.(`[Push ${campaignId}] ${label} failed: ${e?.message || e}`)
    }
  }
  if (outcome.sentIds.length) {
    await run("last_sent_at",
      `UPDATE push_subscription SET last_sent_at = ?, updated_at = now() WHERE id = ANY(?)`,
      [now, outcome.sentIds])
  }
  // Prune/deactivate only once something was delivered — a 403 for every
  // recipient means OUR keys are wrong, not that the list is dead.
  if (channelWorks && outcome.expiredIds.length) {
    await run("prune expired",
      `UPDATE push_subscription SET deleted_at = now(), updated_at = now() WHERE id = ANY(?)`,
      [outcome.expiredIds])
  }
  if (channelWorks && outcome.invalidIds.length) {
    await run("deactivate invalid",
      `UPDATE push_subscription SET is_active = false, updated_at = now() WHERE id = ANY(?)`,
      [outcome.invalidIds])
  }
}

/**
 * Campaigns stuck in "sending" (server restarted mid-send) are closed off
 * as failed once they've made no progress for 30 minutes — the per-page
 * progress update keeps `updated_at` fresh while a send is alive.
 */
export async function closeStaleCampaigns(pg: any) {
  try {
    await pg.raw(
      `UPDATE push_campaign SET status = 'failed', updated_at = now()
       WHERE status = 'sending' AND deleted_at IS NULL AND updated_at < now() - interval '30 minutes'`
    )
  } catch {
    /* non-critical */
  }
}
