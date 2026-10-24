import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { AuthContext, authApi, type AuthState, type User } from '../authContext'

export default function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null | undefined>(undefined)

  useEffect(() => {
    authApi.me().then(setUser, () => setUser(null))
  }, [])

  const value = useMemo<AuthState>(
    () => ({
      user,
      login: async (email, password) => setUser(await authApi.login(email, password)),
      register: async (input) => setUser(await authApi.register(input)),
      logout: async () => {
        await authApi.logout()
        setUser(null)
      },
    }),
    [user],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}
