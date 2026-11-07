import type { SubscriberArgs, SubscriberConfig } from "@medusajs/framework"
import { handleProductEvent } from "../modules/push-notifications/lib/auto-push"

/**
 * New-product auto push (Admin → Push → Auto Push).
 *
 * Fires on create and on update because a product is usually created as a
 * draft and published later — the handler only acts when the product is
 * published and has never been auto-pushed, so ordinary edits cost one
 * indexed lookup and nothing else. The actual sending runs in the
 * background; this handler returns as soon as the decision is made.
 */
export default async function productAutoPush({
  event: { data },
  container,
}: SubscriberArgs<{ id: string }>) {
  try {
    await handleProductEvent(container, data?.id)
  } catch (e: any) {
    container.resolve("logger").warn(`[AutoPush] ${e?.message || e}`)
  }
}

export const config: SubscriberConfig = {
  event: ["product.created", "product.updated"],
}
