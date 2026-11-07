import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"

/**
 * GET /admin/push-subscriptions/facets
 *
 * Drives the audience-filter UI on the campaign composer: every distinct
 * value in the active subscriber set with its count ("Lahore (324)").
 *
 * Counted in SQL with GROUP BY — the old version loaded up to 50k
 * subscriber rows into Node on every page open, which both capped the
 * numbers and loaded the server. Each list is capped at 500 values.
 */
const ACTIVE = `deleted_at IS NULL AND is_active = true`

export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const pg: any = req.scope.resolve("__pg_connection__")

  const facet = async (column: string) => {
    const r = await pg.raw(
      `SELECT ${column} AS key, count(*)::int AS count FROM push_subscription
       WHERE ${ACTIVE} AND ${column} IS NOT NULL AND ${column} <> ''
       GROUP BY ${column} ORDER BY count DESC LIMIT 500`
    )
    return (r?.rows || []).map((row: any) => ({ key: String(row.key), count: Number(row.count) }))
  }

  const [cities, states, countries, device_types, os, browsers, locales, genders, totals] =
    await Promise.all([
      facet("city"),
      facet("state"),
      facet("country"),
      facet("device_type"),
      facet("os"),
      facet("device_browser"),
      facet("locale"),
      facet("gender"),
      pg.raw(
        `SELECT count(*)::int AS total, count(customer_id)::int AS with_customer
         FROM push_subscription WHERE ${ACTIVE}`
      ),
    ])

  const total = Number(totals?.rows?.[0]?.total || 0)
  const withCustomer = Number(totals?.rows?.[0]?.with_customer || 0)

  res.json({
    cities,
    states,
    countries,
    device_types,
    os,
    browsers,
    locales,
    genders,
    total_active: total,
    with_customer: withCustomer,
    anonymous: total - withCustomer,
  })
}
