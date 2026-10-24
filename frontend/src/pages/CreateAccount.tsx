import { Link } from 'react-router-dom'
import AuthForm from './AuthForm'
import { isEmail } from '../validation'

export default function CreateAccount() {
  return (
    <AuthForm
      title="Create account"
      subtitle="Join Campus Customs to save your chats and shop faster."
      submitLabel="Create account"
      fields={[
        { name: 'firstName', label: 'First name', type: 'text', autoComplete: 'given-name' },
        { name: 'lastName', label: 'Last name', type: 'text', autoComplete: 'family-name' },
        { name: 'email', label: 'Email', type: 'email', autoComplete: 'email' },
        { name: 'password', label: 'Password', type: 'password', autoComplete: 'new-password' },
        { name: 'confirm', label: 'Confirm password', type: 'password', autoComplete: 'new-password' },
      ]}
      validate={(v) => {
        if (!v.firstName.trim() || !v.lastName.trim()) return 'Please enter your first and last name.'
        if (!isEmail(v.email)) return 'Please enter a valid email address.'
        if (v.password.length < 8) return 'Password must be at least 8 characters.'
        if (v.password !== v.confirm) return 'Passwords do not match.'
        return null
      }}
      footer={<>Already have an account? <Link to="/login">Log in</Link></>}
    />
  )
}
