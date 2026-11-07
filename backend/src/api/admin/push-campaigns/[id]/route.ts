import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { PUSH_NOTIFICATIONS_MODULE } from "../../../../modules/push-notifications"
import PushNotificationsService from "../../../../modules/push-notifications/service"

/**
 * GET /admin/push-campaigns/:id
 *
 * Campaign detail backed by the per-recipient delivery log — the answer
 * to "who actually got this and why did the rest fail".
 *
 * Returns:
 *   campaign      the campaign row
 *   stats         accepted / shown / clicked / failed, computed from the
 *                 delivery rows rather than the cached counters
 *   failures      breakdown by status + status_code, with a plain-English
 *                 reason and a sample error body per bucket
 *   recipients    optional page of delivery rows (?include_recipients=1)
 *
 * Query: ?status=sent|failed|expired|invalid  ?limit=  ?offset=
 */

const REASONS: Record<string, string> = {
  expired:
    "Subscription is gone (browser data cleared, app uninstalled, or the endpoint expired). These are deleted automatically.",
  invalid:
    "The push service permanently rejected this subscription. Almost always a VAPID key mismatch — the subscriber signed up under a different VAPID key pair than the server signs with now, so it can never be delivered. These are deactivated automatically; the subscriber must re-subscribe.",
  failed:
    "Temporary failure (throttling or the push service was briefly unavailable). Already retried up to 3× during the send; these subscribers stay active and will be retried on the next campaign.",
  sent: "Accepted by the push service.",
}

export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const svc: PushNotificationsService = req.scope.resolve(
    PUSH_NOTIFICATIONS_MODULE
  )
  const { id } = req.params
  const q = req.query as Record<string, any>

  const campaign = await (svc as any).retrievePushCampaign(id).catch(() => null)
  if (!campaign) {
    return res.status(404).json({ error: "Campaign not found" })
  }

  // The delivery log is the source of truth for this campaign's outcome.
  // Counted in SQL — the old version loaded up to 100k rows into Node.
  const pg: any = req.scope.resolve("__pg_connection__")
  const [agg, groups] = await Promise.all([
    pg.raw(
      `SELECT count(*)::int AS total,
              count(*) FILTER (WHERE status = 'sent')::int AS accepted,
              count(*) FILTER (WHERE status = 'failed')::int AS failed,
              count(*) FILTER (WHERE status = 'expired')::int AS expired,
              count(*) FILTER (WHERE status = 'invalid')::int AS invalid,
              count(shown_at)::int AS shown,
              count(clicked_at)::int AS clicked
       FROM push_delivery WHERE campaign_id = ? AND deleted_at IS NULL`,
      [id]
    ),
    pg.raw(
      `SELECT status, status_code, count(*)::int AS count, max(error) AS sample_error
       FROM push_delivery
       WHERE campaign_id = ? AND deleted_at IS NULL AND status <> 'sent'
       GROUP BY status, status_code ORDER BY count DESC`,
      [id]
    ),
  ])
  const a0 = agg?.rows?.[0] || {}
  const stats = {
    total: Number(a0.total || 0),
    accepted: Number(a0.accepted || 0), // handed to the push service successfully
    shown: Number(a0.shown || 0), // confirmed displayed on the device
    clicked: Number(a0.clicked || 0),
    failed: Number(a0.failed || 0), // transient
    expired: Number(a0.expired || 0), // pruned
    invalid: Number(a0.invalid || 0), // deactivated
  }
  const failures = (groups?.rows || []).map((g: any) => ({
    status: g.status,
    status_code: g.status_code ?? null,
    count: Number(g.count),
    reason: REASONS[g.status] || "Unknown failure.",
    sample_error: g.sample_error || undefined,
  }))

  const denominator = stats.accepted || 1
  const rates = {
    // Delivery confirmation is best-effort (the SW callback can be dropped
    // when the device is offline), so treat this as a floor, not a ceiling.
    shown_rate: +((stats.shown / denominator) * 100).toFixed(1),
    click_rate: +((stats.clicked / denominator) * 100).toFixed(1),
    failure_rate: stats.total
      ? +(((stats.total - stats.accepted) / stats.total) * 100).toFixed(1)
      : 0,
  }

  const payload: Record<string, any> = {
    campaign,
    stats,
    rates,
    failures,
  }

  if (q.include_recipients === "1" || q.include_recipients === "true") {
    const limit = Math.min(parseInt(q.limit || "100", 10) || 100, 1000)
    const offset = Math.max(0, parseInt(q.offset || "0", 10) || 0)
    const filters: Record<string, any> = { campaign_id: id }
    if (q.status) filters.status = String(q.status)
    const [rows, count] = await (svc as any).listAndCountPushDeliveries(filters, {
      take: limit,
      skip: offset,
      order: { created_at: "ASC" } as any,
    })
    payload.recipients = rows
    payload.recipients_count = count
  }

  res.json(payload)
}
