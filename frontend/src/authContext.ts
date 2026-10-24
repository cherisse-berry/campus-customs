import { createContext, useContext } from 'react'
import { IS_STATIC } from './api'

export interface User {
  id: number
  name: string
  first_name: string
  last_name: string
  email: string
}

export interface RegisterInput {
  first_name: string
  last_name: string
  email: string
  password: string
}

export interface AuthState {
  /** undefined while the session is being checked, null when logged out. */
  user: User | null | undefined
  login: (email: string, password: string) => Promise<void>
  register: (input: RegisterInput) => Promise<void>
  logout: () => Promise<void>
}

export const AuthContext = createContext<AuthState | null>(null)

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>')
  return ctx
}

const PREVIEW_MESSAGE = 'Accounts need the Campus Customs server, so they are turned off in this preview.'

/** POSTs JSON and returns the parsed body, throwing the server's error message on failure. */
async function postJson<T>(path: string, body?: unknown): Promise<T> {
  if (IS_STATIC) throw new Error(PREVIEW_MESSAGE)
  const res = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'same-origin',
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  if (!res.ok) {
    const data = await res.json().catch(() => null)
    const detail = data?.detail
    throw new Error(typeof detail === 'string' ? detail : 'Something went wrong. Please try again.')
  }
  return (res.status === 204 ? undefined : await res.json()) as T
}

export const authApi = {
  async me(): Promise<User | null> {
    if (IS_STATIC) return null
    const res = await fetch('/api/auth/me', { credentials: 'same-origin' })
    return res.ok ? ((await res.json()) as User) : null
  },
  login: (email: string, password: string) => postJson<User>('/api/auth/login', { email, password }),
  register: (input: RegisterInput) => postJson<User>('/api/auth/register', input),
  logout: () => postJson<void>('/api/auth/logout'),
}
