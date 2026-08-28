import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { PUSH_NOTIFICATIONS_MODULE } from "../../../modules/push-notifications"
import PushNotificationsService from "../../../modules/push-notifications/service"
import {
  configureWebPush,
  sendPushBatch,
} from "../../../modules/push-notifications/lib/web-push-client"

/**
 * GET /admin/push-campaigns
 *   List campaign history (newest first) — drives the dashboard table.
 */
export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const svc: PushNotificationsService = req.scope.resolve(
    PUSH_NOTIFICATIONS_MODULE
  )
  const [campaigns, count] = await (svc as any).listAndCountPushCampaigns(
    {},
    { order: { created_at: "DESC" } as any, take: 100 }
  )
  res.json({ campaigns, count })
}

/**
 * POST /admin/push-campaigns
 *   Create + send a campaign in one shot. Filters are applied to pick
 *   the active subscriber set, then `web-push` fans out the payload.
 *
 * Body:
 *   {
 *     title:        string,
 *     body:         string,
 *     icon_url?:    string,    // small icon (96x96 or 192x192)
 *     image_url?:   string,    // rich media banner
 *     action_url?:  string,    // where the click goes
 *     filter_cities?:  string[],
 *     filter_states?:  string[],
 *     dry_run?: boolean
 *   }
 */
export async function POST(req: MedusaRequest, res: MedusaResponse) {
  const svc: PushNotificationsService = req.scope.resolve(
    PUSH_NOTIFICATIONS_MODULE
  )
  const logger = req.scope.resolve("logger") as any

  const body = (req.body || {}) as Record<string, any>
  const title = (body.title || "").toString().trim()
  const bodyText = (body.body || "").toString().trim()
  if (!title) return res.status(400).json({ error: "title is required" })
  if (!bodyText) return res.status(400).json({ error: "body is required" })

  const cfg = configureWebPush()
  if (!cfg.configured) {
    return res.status(503).json({
      error:
        "VAPID keys not configured. Set VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY in the backend .env (run `npx web-push generate-vapid-keys`).",
    })
  }

  const toList = (v: any): string[] | null =>
    Array.isArray(v) ? v.filter(Boolean).map(String) : null

  const filterCities = toList(body.filter_cities)
  const filterStates = toList(body.filter_states)
  const filterCountries = toList(body.filter_countries)
  const filterDeviceTypes = toList(body.filter_device_types)
  const filterOs = toList(body.filter_os)
  const filterBrowsers = toList(body.filter_browsers)
  const filterGenders = toList(body.filter_genders)
  const customersOnly = body.filter_customers_only === true

  // Find target subscribers
  const filter: Record<string, any> = { is_active: true }
  // We can't combine OR filters easily through the service, so we fetch
  // all active subscribers and filter in-memory (typical campaign sets
  // are < 100k; suitable for a single Node process). For production
  // scale this should be a worker queue + DB-side filtering.
  const all = await (svc as any).listPushSubscriptions(filter, {
    take: 100_000,
  })

  const matchOneOf = (val: any, list: string[] | null) => {
    if (!list || list.length === 0) return true
    if (!val) return false
    const set = new Set(list.map((c) => c.toLowerCase()))
    return set.has(String(val).toLowerCase())
  }

  let targets = all.filter((s: any) => {
    if (!matchOneOf(s.city, filterCities)) return false
    if (!matchOneOf(s.state, filterStates)) return false
    if (!matchOneOf(s.country, filterCountries)) return false
    if (!matchOneOf(s.device_type, filterDeviceTypes)) return false
    if (!matchOneOf(s.os, filterOs)) return false
    if (!matchOneOf(s.device_browser, filterBrowsers)) return false
    if (!matchOneOf(s.gender, filterGenders)) return false
    if (customersOnly && !s.customer_id) return false
    return true
  })

  if (body.dry_run) {
    return res.json({
      success: true,
      dry_run: true,
      total_targeted: targets.length,
    })
  }

  // Persist the campaign first so we have an ID for the audit log
  const [campaign] = await (svc as any).createPushCampaigns([
    {
      title,
      body: bodyText,
      icon_url: body.icon_url ? String(body.icon_url) : null,
      image_url: body.image_url ? String(body.image_url) : null,
      action_url: body.action_url ? String(body.action_url) : null,
      filter_cities: filterCities ? JSON.stringify(filterCities) : null,
      filter_states: filterStates ? JSON.stringify(filterStates) : null,
      filter_countries: filterCountries ? JSON.stringify(filterCountries) : null,
      filter_device_types: filterDeviceTypes
        ? JSON.stringify(filterDeviceTypes)
        : null,
      filter_os: filterOs ? JSON.stringify(filterOs) : null,
      filter_browsers: filterBrowsers ? JSON.stringify(filterBrowsers) : null,
      filter_genders: filterGenders ? JSON.stringify(filterGenders) : null,
      filter_customers_only: customersOnly,
      total_targeted: targets.length,
      total_sent: 0,
      total_failed: 0,
      status: "sending",
    },
  ])

  // Find a publishable API key from the database if not set in environment
  let publishableKey = process.env.MEDUSA_PUBLISHABLE_KEY || process.env.STORE_PUBLISHABLE_KEY
  if (!publishableKey) {
    try {
      const query = req.scope.resolve("query")
      const { data: apiKeys } = await query.graph({
        entity: "api_key",
        fields: ["id", "type"],
        filters: {
          type: "publishable",
        },
      })
      if (apiKeys && apiKeys.length > 0) {
        publishableKey = apiKeys[0].id
      }
    } catch (err) {
      logger?.warn?.(`[PushCampaign] Failed to query publishable API key: ${(err as Error).message}`)
    }
  }

  // Build the payload the SW will receive. We thread the backend URL
  // and publishable key through so the SW can post click events back
  // for CTR tracking. (See `public/sw.js` `trackClick`.)
  const payload: any = {
    title,
    body: bodyText,
    icon: body.icon_url || undefined,
    image: body.image_url || undefined,
    url: body.action_url || "/",
    tag: `campaign-${campaign.id}`,
    backend_url:
      process.env.STORE_PUBLIC_BACKEND_URL ||
      process.env.MEDUSA_BACKEND_URL ||
      undefined,
    publishable_key: publishableKey || undefined,
    data: { campaign_id: campaign.id },
  }


  // Fan out
  const result = await sendPushBatch(
    targets.map((t: any) => ({
      id: t.id,
      endpoint: t.endpoint,
      p256dh: t.p256dh,
      auth: t.auth,
      // Carried through only so the delivery log can attribute the send
      // to a customer; the push client itself ignores it.
      customer_id: t.customer_id || null,
    })),
    payload
  )

  const now = new Date()

  // ── Per-recipient delivery log ───────────────────────────────────
  // One row per subscriber so the dashboard can answer "who got it and
  // what went wrong", and so the SW's shown/click callbacks have a row
  // to stamp. Written in chunks to keep the insert payload sane.
  try {
    const rows = result.results.map(({ sub, result: r }) => ({
      campaign_id: campaign.id,
      subscription_id: sub.id || null,
      endpoint: sub.endpoint,
      customer_id: (sub as any).customer_id || null,
      status: r.success ? "sent" : r.kind === "expired" ? "expired" : r.kind === "invalid" ? "invalid" : "failed",
      status_code: r.statusCode ?? null,
      // Truncated — some push services return a full HTML error page.
      error: r.success ? null : String(r.error || "").slice(0, 500) || null,
      attempts: r.attempts ?? 1,
    }))
    for (let i = 0; i < rows.length; i += 500) {
      await (svc as any).createPushDeliveries(rows.slice(i, i + 500))
    }
  } catch (e) {
    logger?.warn?.(
      `[PushCampaign] Failed to write delivery log: ${(e as Error).message}`
    )
  }

  // Stamp last_sent_at on everyone who actually received it. This column
  // drives the "Last sent" dashboard field and dormant-subscriber
  // segmentation; nothing used to write it, so it was always empty.
  if (result.sentIds.length > 0) {
    try {
      await (svc as any).updatePushSubscriptions(
        result.sentIds.map((id: string) => ({ id, last_sent_at: now }))
      )
    } catch (e) {
      logger?.warn?.(
        `[PushCampaign] Failed to stamp last_sent_at: ${(e as Error).message}`
      )
    }
  }

  // Dead endpoints (404/410) — remove them.
  if (result.expiredIds.length > 0) {
    try {
      await (svc as any).deletePushSubscriptions(result.expiredIds)
    } catch (e) {
      logger?.warn?.(
        `[PushCampaign] Failed to prune ${result.expiredIds.length} expired subs: ${(e as Error).message}`
      )
    }
  }

  // Permanently rejected (400/403/413 — usually a VAPID-key mismatch).
  // Deactivate rather than delete: the row stays auditable, but it stops
  // being targeted, which is what keeps every future campaign from
  // re-failing against the same hopeless endpoints.
  if (result.invalidIds.length > 0) {
    try {
      await (svc as any).updatePushSubscriptions(
        result.invalidIds.map((id: string) => ({ id, is_active: false }))
      )
    } catch (e) {
      logger?.warn?.(
        `[PushCampaign] Failed to deactivate ${result.invalidIds.length} invalid subs: ${(e as Error).message}`
      )
    }
  }

  if (result.failed > 0) {
    logger?.info?.(
      `[PushCampaign ${campaign.id}] sent=${result.sent} failed=${result.failed} ` +
        `breakdown=${JSON.stringify(result.failureBreakdown)}`
    )
  }

  // Update campaign with final stats
  await (svc as any).updatePushCampaigns({
    id: campaign.id,
    total_sent: result.sent,
    total_failed: result.failed,
    status: result.sent === 0 && result.total > 0 ? "failed" : "sent",
    sent_at: now,
  })

  res.json({
    success: true,
    campaign_id: campaign.id,
    total_targeted: result.total,
    total_sent: result.sent,
    total_failed: result.failed,
    expired_pruned: result.expiredIds.length,
    deactivated_invalid: result.invalidIds.length,
    // Surfaced so the admin can see WHY a send underperformed instead of
    // just a failure count (e.g. "invalid:403" ⇒ VAPID keys were rotated).
    failure_breakdown: result.failureBreakdown,
  })
}
