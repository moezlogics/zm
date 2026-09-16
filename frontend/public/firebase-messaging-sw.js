/**
 * SELF-DESTRUCT service worker — DO NOT DELETE THIS FILE.
 *
 * This URL used to host a third-party push worker (LaraPush) that was
 * registered on visitors' browsers at scope "/". That worker owned their
 * push subscription under a different VAPID key, so the store's own
 * campaigns could never be delivered to those browsers.
 *
 * Simply deleting the file does NOT remove an installed worker. Browsers
 * re-check a registered worker's script periodically; when this path
 * returned the site's HTML page (status 200, text/html) that update check
 * failed on the MIME type and the OLD worker stayed installed forever.
 *
 * Serving this tiny valid script instead lets every affected browser pick
 * up an "update", install it, and then unregister itself — which also
 * drops the foreign push subscription. On the visitor's next page load the
 * store's own /sw.js can register and subscribe with the correct key.
 *
 * It never handles push or fetch events and has no effect on browsers that
 * run the store's /sw.js (that is a different script URL).
 */

/* eslint-disable no-restricted-globals */

self.addEventListener("install", () => {
  // Replace the old worker immediately instead of waiting for every tab
  // to close.
  self.skipWaiting()
})

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      try {
        const sub = await self.registration.pushManager.getSubscription()
        if (sub) await sub.unsubscribe()
      } catch (e) {
        /* nothing to clean up */
      }
      try {
        await self.registration.unregister()
      } catch (e) {
        /* already gone */
      }
    })()
  )
})
