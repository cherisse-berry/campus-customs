import { useState, type FormEvent, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../authContext'

export interface Field {
  name: string
  label: string
  type: string
  autoComplete: string
}

interface Props {
  title: string
  subtitle: string
  fields: Field[]
  submitLabel: string
  busyLabel: string
  validate: (values: Record<string, string>) => string | null
  /** Sends the form; throws an Error whose message is shown to the user. */
  onSubmit: (values: Record<string, string>) => Promise<void>
  footer: ReactNode
}

/** Shared log-in / sign-up form. */
export default function AuthForm({ title, subtitle, fields, submitLabel, busyLabel, validate, onSubmit, footer }: Props) {
  const { user, logout } = useAuth()
  const [values, setValues] = useState<Record<string, string>>(
    Object.fromEntries(fields.map((f) => [f.name, ''])),
  )
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function submit(e: FormEvent) {
    e.preventDefault()
    const problem = validate(values)
    setError(problem)
    if (problem) return
    setBusy(true)
    try {
      await onSubmit(values)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong. Please try again.')
      setBusy(false)
    }
  }

  if (user) {
    return (
      <div className="container section auth">
        <div className="auth-card">
          <h1>You're logged in</h1>
          <p className="muted">
            Signed in as <strong>{user.name}</strong> ({user.email}).
          </p>
          <div className="auth-actions">
            <Link to="/products" className="btn">Continue shopping</Link>
            <button className="btn btn-secondary" onClick={() => logout()}>Log out</button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="container section auth">
      <div className="auth-card">
        <h1>{title}</h1>
        <p className="muted">{subtitle}</p>
        <form onSubmit={submit} noValidate>
          {fields.map((f) => (
            <label key={f.name} className="field">
              {f.label}
              <input
                id={f.name}
                name={f.name}
                type={f.type}
                autoComplete={f.autoComplete}
                value={values[f.name]}
                onChange={(e) => setValues({ ...values, [f.name]: e.target.value })}
              />
            </label>
          ))}
          {error && <p className="form-error" role="alert">{error}</p>}
          <button type="submit" className="btn btn-block" disabled={busy}>
            {busy ? busyLabel : submitLabel}
          </button>
        </form>
        <p className="auth-footer">{footer}</p>
      </div>
    </div>
  )
}
