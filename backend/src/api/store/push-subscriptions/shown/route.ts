import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { recordEngagement } from "../../../../modules/push-notifications/lib/engagement"

/**
 * POST /store/push-subscriptions/shown
 *
 * Fired by the service worker when a notification is displayed — the
 * difference between "the push service accepted it" and "the device
 * actually showed it".
 * Body: { endpoint: string, campaign_id?: string }
 */
export async function POST(req: MedusaRequest, res: MedusaResponse) {
  try {
    const body = (req.body || {}) as Record<string, any>
    await recordEngagement(
      req.scope.resolve("__pg_connection__"),
      "shown",
      String(body.endpoint || "").trim(),
      body.campaign_id ? String(body.campaign_id) : null
    )
  } catch {
    /* best-effort */
  }
  res.json({ success: true })
}
