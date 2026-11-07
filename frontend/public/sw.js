/**
 * Web Push Service Worker.
 *
 * Registered by `<PushPermissionPrompt />` once the user grants
 * permission. Receives `push` events from the browser's push service
 * and shows the notification using the payload our backend sent.
 *
 * Payload shape (from backend):
 *   {
 *     title: string,
 *     body:  string,
 *     icon?: string,    // small icon (96x96)
 *     image?: string,   // rich-media banner (Chrome/Edge)
 *     url?: string,     // where the click goes
 *     badge?: string,
 *     tag?: string,     // collapse key — same tag replaces existing
 *     data?: any
 *   }
 */

/* eslint-disable no-restricted-globals */

self.addEventListener("install", (event) => {
  // Activate immediately so the first subscribe doesn't need a refresh
  self.skipWaiting()
})

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim())
})

self.addEventListener("push", (event) => {
  if (!event.data) return

  let payload = {}
  try {
    payload = event.data.json()
  } catch (e) {
    payload = { title: "Notification", body: event.data.text() }
  }

  const title = payload.title || "Notification"
  const options = {
    body: payload.body || "",
    // The backend always sends the site favicon (or the campaign's own
    // icon); the local favicon is only a last resort.
    icon: payload.icon || "/favicon.ico",
    image: payload.image || undefined,
    // Android paints the badge as a white silhouette, so a full-colour
    // icon turns into a white square — only use a badge when one is set.
    badge: payload.badge || undefined,
    tag: payload.tag || undefined,
    // Stash the campaign id (when present) and backend URL so the click
    // handler can post engagement back without another round-trip.
    data: {
      url: payload.url || "/",
      campaign_id: (payload.data && payload.data.campaign_id) || null,
      backend_url: payload.backend_url || null,
      publishable_key: payload.publishable_key || null,
      ...(payload.data || {}),
    },
    requireInteraction: false,
    vibrate: [100, 50, 100],
  }

  event.waitUntil(
    Promise.all([
      self.registration.showNotification(title, options),
      trackShow(options.data),
      rememberBackend(options.data),
    ])
  )
})

/* Where to re-register a rotated subscription (see pushsubscriptionchange).
   Kept in Cache Storage because a service worker has no localStorage. */
const CONFIG_CACHE = "push-config-v1"
const CONFIG_KEY = "/__push-config"

async function rememberBackend(data) {
  try {
    if (!data || !data.backend_url) return
    const cache = await caches.open(CONFIG_CACHE)
    await cache.put(
      CONFIG_KEY,
      new Response(
        JSON.stringify({ backend_url: data.backend_url, publishable_key: data.publishable_key || null }),
        { headers: { "Content-Type": "application/json" } }
      )
    )
  } catch (e) {
    /* best-effort */
  }
}

async function readBackend() {
  try {
    const cache = await caches.open(CONFIG_CACHE)
    const res = await cache.match(CONFIG_KEY)
    return res ? await res.json() : null
  } catch (e) {
    return null
  }
}

/**
 * Best-effort shown/impression tracking. Calls the backend when a
 * notification is received and shown on the device.
 */
async function trackShow(data) {
  try {
    const backend = data && data.backend_url
    const key = data && data.publishable_key
    if (!backend) return
    let endpoint = null
    try {
      const sub = await self.registration.pushManager.getSubscription()
      endpoint = sub && sub.endpoint
    } catch (e) {
      /* ignore */
    }
    if (!endpoint) return
    const headers = { "Content-Type": "application/json" }
    if (key) headers["x-publishable-api-key"] = key
    await fetch(backend.replace(/\/$/, "") + "/store/push-subscriptions/shown", {
      method: "POST",
      headers,
      body: JSON.stringify({
        endpoint,
        campaign_id: data.campaign_id || null,
      }),
      keepalive: true,
    })
  } catch (e) {
    /* best-effort */
  }
}


/**
 * Best-effort click tracking. Calls the backend so the admin dashboard
 * can report CTR per campaign. Resolves silently on any failure — we
 * never want a tracking error to block the page navigation.
 */
async function trackClick(data) {
  try {
    const backend = data && data.backend_url
    const key = data && data.publishable_key
    if (!backend) return
    // Fish the endpoint out of the current PushSubscription so we don't
    // have to thread it through every payload.
    let endpoint = null
    try {
      const sub = await self.registration.pushManager.getSubscription()
      endpoint = sub && sub.endpoint
    } catch (e) {
      /* ignore */
    }
    if (!endpoint) return
    const headers = { "Content-Type": "application/json" }
    if (key) headers["x-publishable-api-key"] = key
    await fetch(backend.replace(/\/$/, "") + "/store/push-subscriptions/click", {
      method: "POST",
      headers,
      body: JSON.stringify({
        endpoint,
        campaign_id: data.campaign_id || null,
      }),
      keepalive: true,
    })
  } catch (e) {
    /* best-effort */
  }
}

self.addEventListener("notificationclick", (event) => {
  event.notification.close()
  const data = event.notification.data || {}
  const targetUrl = data.url || "/"

  event.waitUntil(
    Promise.all([
      trackClick(data),
      self.clients
        .matchAll({ type: "window", includeUncontrolled: true })
        .then((clientList) => {
          // If we already have a tab open on this origin, focus it and navigate
          for (const client of clientList) {
            if ("focus" in client) {
              client.focus()
              if ("navigate" in client) {
                try {
                  return client.navigate(targetUrl)
                } catch (e) {
                  /* fall through to openWindow */
                }
              }
            }
          }
          // Otherwise open a new tab
          if (self.clients.openWindow) {
            return self.clients.openWindow(targetUrl)
          }
        }),
    ])
  )
})

self.addEventListener("pushsubscriptionchange", (event) => {
  // The browser rotated (or expired) this subscription. Re-subscribe with
  // the same server key and register the new endpoint right away, so the
  // subscriber isn't lost until their next visit. The customer link is
  // restored by the page on the next visit as before.
  event.waitUntil(
    (async () => {
      try {
        const old = event.oldSubscription
        const key = old && old.options && old.options.applicationServerKey
        let sub = event.newSubscription
        if (!sub && key) {
          sub = await self.registration.pushManager.subscribe({
            userVisibleOnly: true,
            applicationServerKey: key,
          })
        }
        if (!sub) return
        const cfg = await readBackend()
        if (!cfg || !cfg.backend_url) return
        const json = sub.toJSON()
        const headers = { "Content-Type": "application/json" }
        if (cfg.publishable_key) headers["x-publishable-api-key"] = cfg.publishable_key
        await fetch(cfg.backend_url.replace(/\/$/, "") + "/store/push-subscriptions", {
          method: "POST",
          headers,
          body: JSON.stringify({
            endpoint: json.endpoint,
            keys: json.keys,
            subscribe_source: "sw:pushsubscriptionchange",
          }),
        })
      } catch (e) {
        /* the page re-subscribes on the next visit */
      }
    })()
  )
})
