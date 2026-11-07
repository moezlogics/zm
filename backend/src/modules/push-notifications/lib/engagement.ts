/**
 * Shown / click tracking from the service worker.
 *
 * Atomic SQL increments (no read-then-write, so simultaneous callbacks
 * can't lose counts) and each delivery counts once: a repeated "shown"
 * or a second click on the same notification doesn't inflate the
 * campaign's numbers. A click also proves the notification was shown,
 * so it back-fills `shown_at` when the shown callback got lost.
 *
 * Three small indexed statements per callback — cheap at any volume.
 */

const ID_RE = /^pcamp_[A-Za-z0-9]{10,40}$/

export async function recordEngagement(
  pg: any,
  kind: "shown" | "click",
  endpoint: string,
  campaignIdRaw: string | null
): Promise<void> {
  if (!endpoint || endpoint.length > 1000) return
  const campaignId = campaignIdRaw && ID_RE.test(campaignIdRaw) ? campaignIdRaw : null

  if (kind === "shown") {
    await pg.raw(
      `UPDATE push_subscription SET total_shown = total_shown + 1, last_shown_at = now()
       WHERE endpoint = ? AND deleted_at IS NULL`,
      [endpoint]
    )
  } else {
    await pg.raw(
      `UPDATE push_subscription SET total_clicked = total_clicked + 1, last_clicked_at = now()
       WHERE endpoint = ? AND deleted_at IS NULL`,
      [endpoint]
    )
  }
  if (!campaignId) return

  // Lock the one delivery row, note what was already recorded, then stamp.
  const r = await pg.raw(
    `WITH d AS (
       SELECT id, shown_at, clicked_at FROM push_delivery
       WHERE campaign_id = ? AND endpoint = ? AND deleted_at IS NULL
       LIMIT 1 FOR UPDATE
     ), u AS (
       UPDATE push_delivery p SET
         shown_at = COALESCE(p.shown_at, now()),
         clicked_at = CASE WHEN ? THEN COALESCE(p.clicked_at, now()) ELSE p.clicked_at END,
         updated_at = now()
       FROM d WHERE p.id = d.id
       RETURNING d.shown_at AS prev_shown, d.clicked_at AS prev_clicked
     )
     SELECT prev_shown, prev_clicked FROM u`,
    [campaignId, endpoint, kind === "click"]
  )
  const row = r?.rows?.[0]

  let addShown = 0
  let addClicked = 0
  if (!row) {
    // No delivery row (test push / very old campaign): count it as before.
    if (kind === "shown") addShown = 1
    else addClicked = 1
  } else {
    if (!row.prev_shown) addShown = 1
    if (kind === "click" && !row.prev_clicked) addClicked = 1
  }
  if (addShown || addClicked) {
    await pg.raw(
      `UPDATE push_campaign SET total_shown = total_shown + ?, total_clicked = total_clicked + ?
       WHERE id = ? AND deleted_at IS NULL`,
      [addShown, addClicked, campaignId]
    )
  }
}
