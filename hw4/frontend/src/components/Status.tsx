export function Loading({ label = 'Loading…' }: { label?: string }) {
  return (
    <div className="status" role="status">
      <span className="spinner" aria-hidden="true" />
      {label}
    </div>
  )
}

export function ErrorMessage({ message }: { message: string }) {
  return (
    <div className="status status-error" role="alert">
      {message} Make sure the API server is running, then refresh the page.
    </div>
  )
}
