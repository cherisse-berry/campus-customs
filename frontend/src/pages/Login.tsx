import { Link } from 'react-router-dom'
import AuthForm from './AuthForm'
import { isEmail } from '../validation'

export default function Login() {
  return (
    <AuthForm
      title="Log in"
      subtitle="Welcome back to Campus Customs."
      submitLabel="Log in"
      fields={[
        { name: 'email', label: 'Email', type: 'email', autoComplete: 'email' },
        { name: 'password', label: 'Password', type: 'password', autoComplete: 'current-password' },
      ]}
      validate={(v) => {
        if (!isEmail(v.email)) return 'Please enter a valid email address.'
        if (!v.password) return 'Please enter your password.'
        return null
      }}
      footer={<>New here? <Link to="/create-account">Create an account</Link></>}
    />
  )
}
