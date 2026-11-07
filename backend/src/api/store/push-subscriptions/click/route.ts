import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { recordEngagement } from "../../../../modules/push-notifications/lib/engagement"

/**
 * POST /store/push-subscriptions/click
 *
 * Fired by the service worker's `notificationclick` handler.
 * Body: { endpoint: string, campaign_id?: string }
 *
 * Best-effort: always answers 200 so the SW never retries or logs noise.
 */
export async function POST(req: MedusaRequest, res: MedusaResponse) {
  try {
    const body = (req.body || {}) as Record<string, any>
    await recordEngagement(
      req.scope.resolve("__pg_connection__"),
      "click",
      String(body.endpoint || "").trim(),
      body.campaign_id ? String(body.campaign_id) : null
    )
  } catch {
    /* never fail the SW callback */
  }
  res.json({ success: true })
}
