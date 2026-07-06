/**
 * Server-rendered LCP hero image for PDP.
 *
 * ImageGallery is a client component that reads `useSearchParams()` for
 * variant image filtering. Without a Suspense boundary that forces a
 * BAILOUT_TO_CLIENT_SIDE_RENDERING — the whole PDP shell shows a skeleton
 * until JS hydrates, which destroys LCP on mobile PageSpeed.
 *
 * This component renders in the initial HTML (eager + fetchpriority=high)
 * and doubles as the Suspense fallback while the interactive gallery loads.
 */
type ProductLcpImageProps = {
  src: string
  alt: string
  aspectRatioClass?: string
  className?: string
}

export default function ProductLcpImage({
  src,
  alt,
  aspectRatioClass = "aspect-square",
  className = "",
}: ProductLcpImageProps) {
  return (
    <div
      className={`relative ${aspectRatioClass} w-full rounded-[var(--radius-card)] bg-bg overflow-hidden ${className}`}
      data-lcp-hero="true"
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={src}
        alt={alt}
        fetchPriority="high"
        loading="eager"
        decoding="async"
        className="absolute inset-0 w-full h-full object-cover"
      />
    </div>
  )
}
