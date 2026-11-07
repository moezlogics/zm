import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { PUSH_NOTIFICATIONS_MODULE } from "../../../modules/push-notifications"
import PushNotificationsService from "../../../modules/push-notifications/service"
import { configureWebPush } from "../../../modules/push-notifications/lib/web-push-client"
import {
  type AudienceFilters,
  buildPayload,
  closeStaleCampaigns,
  countAudience,
  enqueueSend,
  getPushContext,
  runCampaignSend,
  slugify,
  withUtm,
} from "../../../modules/push-notifications/lib/campaign-engine"

/**
 * GET /admin/push-campaigns?source=manual|auto
 *   Campaign history, newest first.
 */
export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const svc: PushNotificationsService = req.scope.resolve(PUSH_NOTIFICATIONS_MODULE)
  const pg: any = req.scope.resolve("__pg_connection__")
  await closeStaleCampaigns(pg)

  const source = String((req.query as any)?.source || "")
  const filters: Record<string, any> = {}
  if (source === "auto") filters.source = "auto"

  const [campaigns, count] = await (svc as any).listAndCountPushCampaigns(filters, {
    order: { created_at: "DESC" } as any,
    take: 100,
  })
  res.json({
    campaigns: source === "manual" ? campaigns.filter((c: any) => c.source !== "auto") : campaigns,
    count,
  })
}

const toList = (v: any): string[] | null =>
  Array.isArray(v) && v.length ? v.filter(Boolean).map(String) : null

/**
 * POST /admin/push-campaigns
 *   Create + send a campaign. The audience is filtered and counted in SQL;
 *   sending happens in the background, page by page.
 *
 * Body: { title, body, icon_url?, image_url?, action_url?, add_utm?,
 *         filter_cities?, filter_states?, filter_countries?,
 *         filter_device_types?, filter_os?, filter_browsers?,
 *         filter_genders?, filter_customers_only?, dry_run? }
 *
 * icon_url empty → the site favicon (Site Settings), so every push carries
 * the store's own icon.
 */
export async function POST(req: MedusaRequest, res: MedusaResponse) {
  const svc: PushNotificationsService = req.scope.resolve(PUSH_NOTIFICATIONS_MODULE)
  const logger = req.scope.resolve("logger") as any
  const pg: any = req.scope.resolve("__pg_connection__")

  const body = (req.body || {}) as Record<string, any>
  const title = String(body.title || "").trim()
  const bodyText = String(body.body || "").trim()

  const filterCities = toList(body.filter_cities)
  const filterStates = toList(body.filter_states)
  const filterCountries = toList(body.filter_countries)
  const filterDeviceTypes = toList(body.filter_device_types)
  const filterOs = toList(body.filter_os)
  const filterBrowsers = toList(body.filter_browsers)
  const filterGenders = toList(body.filter_genders)
  const customersOnly = body.filter_customers_only === true

  const audience: AudienceFilters = {
    cities: filterCities,
    states: filterStates,
    countries: filterCountries,
    device_types: filterDeviceTypes,
    os: filterOs,
    browsers: filterBrowsers,
    genders: filterGenders,
    customers_only: customersOnly,
  }

  // Reach estimate: one COUNT(*) — cheap enough to run on every filter change.
  if (body.dry_run) {
    const total_targeted = await countAudience(pg, audience)
    return res.json({ success: true, dry_run: true, total_targeted })
  }

  if (!title) return res.status(400).json({ error: "title is required" })
  if (!bodyText) return res.status(400).json({ error: "body is required" })

  if (!configureWebPush().configured) {
    return res.status(503).json({
      error:
        "VAPID keys not configured. Set VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY in the backend .env (run `npx web-push generate-vapid-keys`).",
    })
  }

  const targeted = await countAudience(pg, audience)
  const ctx = await getPushContext(req.scope)
  const json = (v: string[] | null) => (v ? JSON.stringify(v) : null)

  const [campaign] = await (svc as any).createPushCampaigns([
    {
      title,
      body: bodyText,
      icon_url: body.icon_url ? String(body.icon_url) : null,
      image_url: body.image_url ? String(body.image_url) : null,
      action_url: body.action_url ? String(body.action_url) : null,
      filter_cities: json(filterCities),
      filter_states: json(filterStates),
      filter_countries: json(filterCountries),
      filter_device_types: json(filterDeviceTypes),
      filter_os: json(filterOs),
      filter_browsers: json(filterBrowsers),
      filter_genders: json(filterGenders),
      filter_customers_only: customersOnly,
      total_targeted: targeted,
      total_sent: 0,
      total_failed: 0,
      status: "sending",
      source: "manual",
    },
  ])

  const actionUrl = (campaign.action_url as string | null) || ctx.storefrontUrl + "/"
  const payload = buildPayload(ctx, {
    id: campaign.id,
    title,
    body: bodyText,
    icon_url: campaign.icon_url,
    image_url: campaign.image_url,
    action_url: body.add_utm === false ? actionUrl : withUtm(actionUrl, slugify(title)),
  })

  res.status(202).json({
    success: true,
    queued: true,
    campaign_id: campaign.id,
    total_targeted: targeted,
    status: "sending",
    message: "Campaign queued. Sending happens in the background.",
  })

  enqueueSend(async () => {
    await runCampaignSend({
      container: req.scope,
      svc,
      pg,
      logger,
      campaignId: campaign.id,
      filters: audience,
      payload,
    })
  }).catch(async (e: any) => {
    logger?.error?.(`[PushCampaign ${campaign.id}] background send crashed: ${e?.message || e}`)
    try {
      await (svc as any).updatePushCampaigns({ id: campaign.id, status: "failed", sent_at: new Date() })
    } catch {
      /* nothing more we can do */
    }
  })
}
