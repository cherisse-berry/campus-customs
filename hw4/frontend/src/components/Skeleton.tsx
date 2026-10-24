/** Placeholder cards with a soft shimmer while products load, so the layout doesn't jump. */
export function ProductGridSkeleton({ count = 8, label = 'Loading products…' }: { count?: number; label?: string }) {
  return (
    <div className="product-grid" role="status" aria-label={label}>
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="skeleton-card" aria-hidden="true">
          <div className="skeleton skeleton-image" />
          <div className="skeleton skeleton-line short" />
          <div className="skeleton skeleton-line" />
          <div className="skeleton skeleton-line medium" />
        </div>
      ))}
      <span className="visually-hidden">{label}</span>
    </div>
  )
}
