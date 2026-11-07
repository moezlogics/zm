import { defineRouteConfig } from "@medusajs/admin-sdk"
import { Badge, Button, Container, Heading, Input, Label, Switch, toast } from "@medusajs/ui"
import { useEffect, useRef, useState } from "react"
import { uploadFile } from "../../../lib/settings-sdk"
import {
  A,
  adminDescription,
  adminHelpText,
  adminSection,
  adminSectionTitle,
} from "../../../lib/admin-theme"

type Settings = {
  enabled: boolean
  partitions: number
  cooldown_hours: number
  quiet_start: number | null
  quiet_end: number | null
  title_template: string
  body_template: string
  require_image: boolean
  utm: boolean
  baseline_at: string | null
}

type LogRow = {
  id: string
  product_id: string
  product_title: string | null
  status: "sent" | "skipped" | "failed"
  reason: string | null
  partition_index: number | null
  partitions_total: number | null
  campaign_id: string | null
  created_at: string
  total_targeted: number | null
  total_sent: number | null
  total_shown: number | null
  total_clicked: number | null
  campaign_status: string | null
}

type Data = {
  settings: Settings
  defaults: Settings
  group_sizes: number[]
  next_group: number
  quiet_now: boolean
  totals: Record<string, number>
  preview: {
    product_title: string
    title: string
    body: string
    image: string | null
    icon: string
    url: string
  } | null
  log: LogRow[]
  site_icon: string
}

async function load(): Promise<Data> {
  const res = await fetch("/admin/push-auto", { credentials: "include" })
  if (!res.ok) throw new Error(await res.text())
  return res.json()
}

async function save(settings: Partial<Settings> & { default_icon_url?: string }) {
  const res = await fetch("/admin/push-auto", {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ settings }),
  })
  if (!res.ok) throw new Error(await res.text())
  return res.json()
}

const HOURS = Array.from({ length: 24 }, (_, h) => h)
const hourLabel = (h: number) => {
  const am = h < 12
  const v = h % 12 === 0 ? 12 : h % 12
  return `${v}:00 ${am ? "AM" : "PM"}`
}

const STATUS_COLOR: Record<string, "green" | "orange" | "red" | "grey"> = {
  sent: "green",
  skipped: "orange",
  failed: "red",
}

const selectStyle: React.CSSProperties = {
  height: 32,
  borderRadius: 6,
  border: A.border,
  background: A.bgField,
  color: A.fg,
  padding: "0 8px",
  fontSize: 13,
}

const AutoPushPage = () => {
  const [data, setData] = useState<Data | null>(null)
  const [form, setForm] = useState<Settings | null>(null)
  const [icon, setIcon] = useState("")
  const [savedIcon, setSavedIcon] = useState("")
  const [busy, setBusy] = useState(false)
  const iconRef = useRef<HTMLInputElement>(null)

  const refresh = async () => {
    try {
      const d = await load()
      setData(d)
      setForm(d.settings)
    } catch (e) {
      toast.error("Load failed: " + (e as Error).message)
    }
  }

  useEffect(() => {
    refresh()
    fetch("/admin/site-settings", { credentials: "include" })
      .then((r) => r.json())
      .then((j) => {
        const v = j?.settings?.push_default_icon_url || ""
        setIcon(v)
        setSavedIcon(v)
      })
      .catch(() => undefined)
  }, [])

  if (!data || !form) {
    return (
      <Container className="p-6">
        <p>Loading…</p>
      </Container>
    )
  }

  const persist = async (patch: Partial<Settings> & { default_icon_url?: string }, msg = "Saved") => {
    setBusy(true)
    try {
      const r = await save(patch)
      if (typeof patch.default_icon_url === "string") setSavedIcon(patch.default_icon_url)
      if (r.baselined) {
        toast.success(
          `Auto push is ON. ${r.baselined} products that were already published will not be pushed — only new ones.`
        )
      } else {
        toast.success(msg)
      }
      await refresh()
    } catch (e) {
      toast.error("Save failed: " + (e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const totalSubs = data.group_sizes.reduce((a, b) => a + b, 0)
  const maxGroup = Math.max(1, ...data.group_sizes)
  const set = <K extends keyof Settings>(k: K, v: Settings[K]) => setForm({ ...form, [k]: v })
  const dirty = JSON.stringify(form) !== JSON.stringify(data.settings) || icon !== savedIcon

  return (
    <Container className="p-6">
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 20, gap: 12, flexWrap: "wrap" }}>
        <div>
          <Heading>⚡ Auto Push — new products</Heading>
          <p style={{ fontSize: 13, color: A.fgSubtle, marginTop: 4, maxWidth: 720 }}>
            When a product is <b>published</b> (not draft, not blog posts), one subscriber group gets a push
            about it. The next product goes to the next group, and so on in a loop — every subscriber hears
            about one product in {form.partitions}, whether you have 100 or 10 million subscribers.
          </p>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <a href="/app/push-notifications/campaigns" style={{ textDecoration: "none" }}>
            <Button variant="secondary">← Campaigns</Button>
          </a>
        </div>
      </div>

      {/* On / off */}
      <div style={{ ...adminSection, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16, flexWrap: "wrap" }}>
        <div>
          <h3 style={adminSectionTitle}>
            Auto push is{" "}
            <span style={{ color: data.settings.enabled ? A.success : A.fgSubtle }}>
              {data.settings.enabled ? "ON" : "OFF"}
            </span>
          </h3>
          <p style={adminDescription}>
            {data.settings.enabled
              ? `Next new product goes to group ${data.next_group + 1} of ${data.settings.partitions}` +
                (data.quiet_now ? " — quiet hours right now, pushes are skipped." : ".")
              : "Switch on to start. Products already published won't be pushed — only ones published after this."}
          </p>
        </div>
        <Switch
          checked={data.settings.enabled}
          disabled={busy}
          onCheckedChange={(v) => persist({ enabled: v }, v ? "Auto push is ON" : "Auto push is OFF")}
        />
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1.15fr 1fr", gap: 20, alignItems: "flex-start" }}>
        <div>
          {/* Groups */}
          <div style={adminSection}>
            <h3 style={adminSectionTitle}>Subscriber groups</h3>
            <p style={adminDescription}>
              {totalSubs.toLocaleString()} active subscribers split into {data.settings.partitions} groups. A
              subscriber always stays in the same group; new subscribers spread evenly.
            </p>
            <div style={{ display: "flex", gap: 4, alignItems: "flex-end", height: 90, marginTop: 14 }}>
              {data.group_sizes.map((n, i) => (
                <div key={i} title={`Group ${i + 1}: ${n.toLocaleString()}`} style={{ flex: 1, textAlign: "center" }}>
                  <div
                    style={{
                      height: Math.max(4, (n / maxGroup) * 64),
                      borderRadius: 4,
                      background: i === data.next_group && data.settings.enabled ? A.interactive : A.bgField,
                      border: A.border,
                    }}
                  />
                  <div style={{ fontSize: 10, color: i === data.next_group ? A.fg : A.fgMuted, marginTop: 4 }}>
                    {i + 1}
                  </div>
                </div>
              ))}
            </div>
            <p style={{ ...adminHelpText, marginTop: 8 }}>Highlighted = the group the next new product goes to.</p>
          </div>

          {/* Settings */}
          <div style={adminSection}>
            <h3 style={adminSectionTitle}>Settings</h3>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, marginTop: 14 }}>
              <div>
                <Label style={{ display: "block", marginBottom: 6, color: A.fg }}>Number of groups</Label>
                <Input
                  type="number"
                  min={1}
                  max={50}
                  value={form.partitions}
                  onChange={(e) => set("partitions", Math.max(1, Math.min(50, Number(e.target.value) || 1)))}
                />
                <p style={adminHelpText}>10 = each subscriber gets about 1 push per 10 new products.</p>
              </div>
              <div>
                <Label style={{ display: "block", marginBottom: 6, color: A.fg }}>Cool-down per group (hours)</Label>
                <Input
                  type="number"
                  min={0}
                  max={168}
                  value={form.cooldown_hours}
                  onChange={(e) => set("cooldown_hours", Math.max(0, Math.min(168, Number(e.target.value) || 0)))}
                />
                <p style={adminHelpText}>
                  A group never gets two auto pushes within this time (protects against bulk imports). 0 = off.
                </p>
              </div>
              <div>
                <Label style={{ display: "block", marginBottom: 6, color: A.fg }}>Quiet hours (Pakistan time)</Label>
                <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                  <select
                    style={selectStyle}
                    value={form.quiet_start ?? ""}
                    onChange={(e) => set("quiet_start", e.target.value === "" ? null : Number(e.target.value))}
                  >
                    <option value="">Off</option>
                    {HOURS.map((h) => (
                      <option key={h} value={h}>{hourLabel(h)}</option>
                    ))}
                  </select>
                  <span style={{ color: A.fgSubtle, fontSize: 12 }}>to</span>
                  <select
                    style={selectStyle}
                    value={form.quiet_end ?? ""}
                    onChange={(e) => set("quiet_end", e.target.value === "" ? null : Number(e.target.value))}
                  >
                    <option value="">Off</option>
                    {HOURS.map((h) => (
                      <option key={h} value={h}>{hourLabel(h)}</option>
                    ))}
                  </select>
                </div>
                <p style={adminHelpText}>Products published in this window are not pushed (e.g. 11 PM to 9 AM).</p>
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 10, justifyContent: "center" }}>
                <label style={{ display: "inline-flex", gap: 8, alignItems: "center", fontSize: 13, color: A.fg }}>
                  <input
                    type="checkbox"
                    checked={form.require_image}
                    onChange={(e) => set("require_image", e.target.checked)}
                  />
                  Only push products that have an image
                </label>
                <label style={{ display: "inline-flex", gap: 8, alignItems: "center", fontSize: 13, color: A.fg }}>
                  <input type="checkbox" checked={form.utm} onChange={(e) => set("utm", e.target.checked)} />
                  Add UTM tracking to the link
                </label>
              </div>
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: 12, marginTop: 18 }}>
              <div>
                <Label style={{ display: "block", marginBottom: 6, color: A.fg }}>Title template</Label>
                <Input value={form.title_template} onChange={(e) => set("title_template", e.target.value)} />
              </div>
              <div>
                <Label style={{ display: "block", marginBottom: 6, color: A.fg }}>Body template</Label>
                <Input value={form.body_template} onChange={(e) => set("body_template", e.target.value)} />
                <p style={adminHelpText}>
                  Placeholders: {"{title}"} {"{price}"} {"{description}"} (first line) {"{category}"} {"{site}"}. The
                  product image is used as the big picture and the click opens the product page.
                </p>
              </div>
              <div>
                <Label style={{ display: "block", marginBottom: 6, color: A.fg }}>
                  Notification icon (all pushes)
                </Label>
                <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                  <Input
                    placeholder={`Empty = site favicon (${data.site_icon})`}
                    value={icon}
                    onChange={(e) => setIcon(e.target.value)}
                  />
                  <input
                    ref={iconRef}
                    type="file"
                    accept="image/png,image/jpeg,image/webp"
                    style={{ display: "none" }}
                    onChange={async (e) => {
                      const f = e.target.files?.[0]
                      if (!f) return
                      try {
                        setIcon((await uploadFile(f)).url)
                      } catch (err) {
                        toast.error("Upload failed: " + (err as Error).message)
                      }
                    }}
                  />
                  <Button variant="secondary" onClick={() => iconRef.current?.click()}>
                    Upload
                  </Button>
                </div>
                <p style={adminHelpText}>
                  Leave empty to use the site favicon. A square PNG (192×192) looks sharpest on Android.
                </p>
              </div>
            </div>

            <div style={{ display: "flex", gap: 8, marginTop: 16 }}>
              <Button
                variant="primary"
                disabled={busy || !dirty}
                onClick={() => {
                  const { baseline_at, enabled, ...rest } = form
                  persist({ ...rest, default_icon_url: icon })
                }}
              >
                Save settings
              </Button>
              <Button variant="secondary" disabled={busy} onClick={() => setForm({ ...data.defaults, enabled: data.settings.enabled, baseline_at: data.settings.baseline_at })}>
                Reset to defaults
              </Button>
            </div>
          </div>
        </div>

        <div>
          {/* Preview */}
          <div style={adminSection}>
            <h3 style={adminSectionTitle}>Preview</h3>
            <p style={adminDescription}>
              {data.preview ? `Using your newest product: ${data.preview.product_title}` : "No published product yet."}
            </p>
            {data.preview && (
              <div style={{ marginTop: 12, background: "#f3f4f6", borderRadius: 12, padding: 14, color: "#111827", boxShadow: "0 4px 14px rgba(0,0,0,0.18)" }}>
                <div style={{ display: "flex", gap: 12 }}>
                  <div
                    style={{
                      width: 44,
                      height: 44,
                      borderRadius: 8,
                      flexShrink: 0,
                      background: `#fff url(${icon || data.preview.icon}) center/contain no-repeat`,
                    }}
                  />
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: 11, color: "#6b7280" }}>{new URL(data.preview.url).hostname} • now</div>
                    <div style={{ fontWeight: 700, fontSize: 14, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                      {data.preview.title}
                    </div>
                    <div style={{ fontSize: 13, color: "#374151", lineHeight: 1.4 }}>{data.preview.body}</div>
                  </div>
                </div>
                {data.preview.image && (
                  <img src={data.preview.image} alt="" style={{ width: "100%", marginTop: 10, borderRadius: 8, maxHeight: 180, objectFit: "contain", background: "#fff" }} />
                )}
              </div>
            )}
            <p style={{ ...adminHelpText, marginTop: 8 }}>Save to update the preview after editing the templates.</p>
          </div>

          {/* Totals */}
          <div style={{ ...adminSection, display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 10 }}>
            {[
              ["Pushed", data.totals.sent || 0, A.success],
              ["Skipped", data.totals.skipped || 0, A.warning],
              ["Failed", data.totals.failed || 0, A.danger],
            ].map(([label, n, color]) => (
              <div key={String(label)} style={{ textAlign: "center" }}>
                <div style={{ fontSize: 22, fontWeight: 700, color: String(color) }}>{Number(n).toLocaleString()}</div>
                <div style={{ fontSize: 12, color: A.fgSubtle }}>{label}</div>
              </div>
            ))}
          </div>

          {/* Log */}
          <div style={adminSection}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <h3 style={adminSectionTitle}>Recent auto pushes</h3>
              <Button size="small" variant="transparent" onClick={refresh}>
                Refresh
              </Button>
            </div>
            {data.log.length === 0 ? (
              <p style={{ fontSize: 13, color: A.fgSubtle, marginTop: 8 }}>
                Nothing yet — publish a new product with auto push on.
              </p>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 10 }}>
                {data.log.map((r) => {
                  const ctr =
                    r.total_shown && r.total_clicked ? Math.round((r.total_clicked / r.total_shown) * 100) : null
                  return (
                    <div key={r.id} style={{ border: A.border, borderRadius: 8, padding: 10, background: A.bgField }}>
                      <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                        <span style={{ fontSize: 13, fontWeight: 600, color: A.fg, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                          {r.product_title || r.product_id}
                        </span>
                        <Badge size="xsmall" color={STATUS_COLOR[r.status] || "grey"}>
                          {r.status === "sent" && r.campaign_status === "sending" ? "sending" : r.status}
                        </Badge>
                      </div>
                      <div style={{ display: "flex", gap: 12, flexWrap: "wrap", fontSize: 11, color: A.fgMuted, marginTop: 4 }}>
                        {r.partition_index !== null && r.partitions_total && (
                          <span>👥 group {r.partition_index + 1}/{r.partitions_total}</span>
                        )}
                        {r.status === "sent" && (
                          <>
                            <span>📨 {r.total_sent ?? 0}/{r.total_targeted ?? 0}</span>
                            <span>👁 {r.total_shown ?? 0}</span>
                            <span>👆 {r.total_clicked ?? 0}{ctr !== null ? ` (${ctr}% CTR)` : ""}</span>
                          </>
                        )}
                        {r.reason && <span style={{ color: r.status === "failed" ? A.danger : A.warning }}>{r.reason}</span>}
                        <span style={{ marginLeft: "auto" }}>{new Date(r.created_at).toLocaleString()}</span>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        </div>
      </div>
    </Container>
  )
}

export const config = defineRouteConfig({
  label: "Auto Push",
})

export default AutoPushPage
