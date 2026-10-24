import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../authContext'
import AuthForm from './AuthForm'
import { isEmail } from '../validation'

const MIN_PASSWORD_LENGTH = 8

export default function CreateAccount() {
  const { register } = useAuth()
  const navigate = useNavigate()

  return (
    <AuthForm
      title="Create account"
      subtitle="Join Campus Customs to save your chats and shop faster."
      submitLabel="Create account"
      busyLabel="Creating account…"
      fields={[
        { name: 'firstName', label: 'First name', type: 'text', autoComplete: 'given-name' },
        { name: 'lastName', label: 'Last name', type: 'text', autoComplete: 'family-name' },
        { name: 'email', label: 'Email', type: 'email', autoComplete: 'email' },
        { name: 'password', label: 'Password', type: 'password', autoComplete: 'new-password' },
        { name: 'confirm', label: 'Confirm password', type: 'password', autoComplete: 'new-password' },
      ]}
      validate={(v) => {
        if (!v.firstName.trim() || !v.lastName.trim()) return 'Please enter your first and last name.'
        if (!isEmail(v.email.trim())) return 'Please enter a valid email address.'
        if (v.password.length < MIN_PASSWORD_LENGTH)
          return `Password must be at least ${MIN_PASSWORD_LENGTH} characters.`
        if (v.password !== v.confirm) return 'Passwords do not match.'
        return null
      }}
      onSubmit={async (v) => {
        await register({
          first_name: v.firstName.trim(),
          last_name: v.lastName.trim(),
          email: v.email.trim(),
          password: v.password,
        })
        navigate('/')
      }}
      footer={<>Already have an account? <Link to="/login">Log in</Link></>}
    />
  )
}
