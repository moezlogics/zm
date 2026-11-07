import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { SITE_SETTINGS_MODULE } from "../../../modules/site-settings"
import {
  getPushContext,
  partitionSizes,
} from "../../../modules/push-notifications/lib/campaign-engine"
import {
  AUTO_DEFAULTS,
  inQuietHours,
  loadProduct,
  nextPartition,
  parseAutoSettings,
  renderTemplate,
  runBaseline,
  toSettingsRecord,
  type AutoSettings,
} from "../../../modules/push-notifications/lib/auto-push"

/**
 * GET  /admin/push-auto   settings, group sizes, next group, preview, log
 * POST /admin/push-auto   save settings (switching on records the baseline)
 */
export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const pg: any = req.scope.resolve("__pg_connection__")
  const ctx = await getPushContext(req.scope, true)
  const auto = parseAutoSettings(ctx.settings)

  const [sizes, next, logRows, counts, latest] = await Promise.all([
    partitionSizes(pg, auto.partitions),
    nextPartition(pg, auto.partitions),
    pg.raw(
      `SELECT l.id, l.product_id, l.product_title, l.status, l.reason, l.partition_index,
              l.partitions_total, l.campaign_id, l.created_at,
              c.total_targeted, c.total_sent, c.total_shown, c.total_clicked, c.status AS campaign_status
       FROM push_auto_log l
       LEFT JOIN push_campaign c ON c.id = l.campaign_id
       WHERE l.deleted_at IS NULL AND l.status <> 'baseline'
       ORDER BY l.created_at DESC LIMIT 40`
    ),
    pg.raw(
      `SELECT status, count(*)::int AS n FROM push_auto_log WHERE deleted_at IS NULL GROUP BY status`
    ),
    pg.raw(
      `SELECT id FROM product WHERE status = 'published' AND deleted_at IS NULL
       ORDER BY created_at DESC LIMIT 1`
    ),
  ])

  // Preview with the newest published product.
  let preview: any = null
  const latestId = latest?.rows?.[0]?.id
  if (latestId) {
    const p = await loadProduct(req.scope, latestId).catch(() => null)
    if (p) {
      preview = {
        product_title: p.title,
        title: renderTemplate(auto.title_template, p, ctx.siteName),
        body: renderTemplate(auto.body_template, p, ctx.siteName),
        image: p.thumbnail,
        icon: ctx.defaultIcon,
        url: ctx.storefrontUrl + p.path,
      }
    }
  }

  const totals: Record<string, number> = {}
  for (const r of counts?.rows || []) totals[r.status] = Number(r.n)

  res.json({
    settings: auto,
    defaults: AUTO_DEFAULTS,
    group_sizes: sizes,
    next_group: next,
    quiet_now: inQuietHours(auto),
    totals,
    preview,
    log: logRows?.rows || [],
    site_icon: ctx.defaultIcon,
  })
}

export async function POST(req: MedusaRequest, res: MedusaResponse) {
  const body = ((req.body || {}) as any).settings || {}
  const settingsSvc: any = req.scope.resolve(SITE_SETTINGS_MODULE)
  const before = parseAutoSettings(await settingsSvc.getAll())

  const merged: AutoSettings = parseAutoSettings({
    ...toSettingsRecord(before),
    ...toSettingsRecord({ ...before, ...sanitize(body) }),
  })
  await settingsSvc.bulkUpsert(toSettingsRecord(merged))

  // Default icon override lives next to the auto-push settings in the UI.
  if (typeof body.default_icon_url === "string") {
    await settingsSvc.bulkUpsert({ push_default_icon_url: body.default_icon_url.trim() })
  }

  // Switching on: everything already published becomes "baseline" so only
  // products published from now on get pushed.
  let baselined = 0
  if (merged.enabled && !before.enabled) baselined = await runBaseline(req.scope)

  await getPushContext(req.scope, true)
  res.json({ success: true, settings: merged, baselined })
}

function sanitize(b: any): Partial<AutoSettings> {
  const out: Partial<AutoSettings> = {}
  if (typeof b.enabled === "boolean") out.enabled = b.enabled
  if (b.partitions !== undefined) out.partitions = Number(b.partitions)
  if (b.cooldown_hours !== undefined) out.cooldown_hours = Number(b.cooldown_hours)
  if (b.quiet_start !== undefined) out.quiet_start = b.quiet_start === "" || b.quiet_start === null ? null : Number(b.quiet_start)
  if (b.quiet_end !== undefined) out.quiet_end = b.quiet_end === "" || b.quiet_end === null ? null : Number(b.quiet_end)
  if (typeof b.title_template === "string") out.title_template = b.title_template.slice(0, 200)
  if (typeof b.body_template === "string") out.body_template = b.body_template.slice(0, 300)
  if (typeof b.require_image === "boolean") out.require_image = b.require_image
  if (typeof b.utm === "boolean") out.utm = b.utm
  return out
}
