import { useState, type FormEvent, type ReactNode } from 'react'

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
  validate: (values: Record<string, string>) => string | null
  footer: ReactNode
}

/**
 * Shared log-in / sign-up form. Accounts are not connected yet, so submitting
 * only validates the form; nothing is sent or saved.
 */
export default function AuthForm({ title, subtitle, fields, submitLabel, validate, footer }: Props) {
  const [values, setValues] = useState<Record<string, string>>(
    Object.fromEntries(fields.map((f) => [f.name, ''])),
  )
  const [error, setError] = useState<string | null>(null)
  const [submitted, setSubmitted] = useState(false)

  function onSubmit(e: FormEvent) {
    e.preventDefault()
    const problem = validate(values)
    setError(problem)
    setSubmitted(problem === null)
  }

  return (
    <div className="container section auth">
      <div className="auth-card">
        <h1>{title}</h1>
        <p className="muted">{subtitle}</p>
        <form onSubmit={onSubmit} noValidate>
          {fields.map((f) => (
            <label key={f.name} className="field">
              {f.label}
              <input
                name={f.name}
                type={f.type}
                autoComplete={f.autoComplete}
                value={values[f.name]}
                onChange={(e) => setValues({ ...values, [f.name]: e.target.value })}
              />
            </label>
          ))}
          {error && <p className="form-error" role="alert">{error}</p>}
          {submitted && (
            <p className="form-notice" role="status">
              Accounts aren't connected yet. Sign-in will be enabled in a later step.
            </p>
          )}
          <button type="submit" className="btn btn-block">{submitLabel}</button>
        </form>
        <p className="auth-footer">{footer}</p>
      </div>
    </div>
  )
}
