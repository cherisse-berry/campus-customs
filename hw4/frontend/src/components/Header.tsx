import { useEffect, useState } from 'react'
import { Link, NavLink } from 'react-router-dom'
import { useAuth } from '../authContext'

const links = [
  { to: '/', label: 'Home', end: true },
  { to: '/products', label: 'Shop' },
  { to: '/about', label: 'About Us' },
]

export default function Header() {
  const { user, logout } = useAuth()
  const [open, setOpen] = useState(false)
  const [scrolled, setScrolled] = useState(false)
  const close = () => setOpen(false)

  // A soft shadow once the page scrolls, so the sticky header separates from the content.
  useEffect(() => {
    const update = () => setScrolled(window.scrollY > 8)
    update()
    window.addEventListener('scroll', update, { passive: true })
    return () => window.removeEventListener('scroll', update)
  }, [])

  return (
    <header className={`site-header ${scrolled ? 'is-scrolled' : ''}`}>
      <div className="announcement">Yale apparel for students, alumni and family · Questions? Chat with us in the corner</div>
      <div className="header-inner container">
        <Link to="/" className="brand" onClick={close}>
          <span className="brand-mark">CC</span>
          <span className="brand-text">
            Campus Customs
            <small>Yale Apparel · New Haven</small>
          </span>
        </Link>

        <button
          className="menu-toggle"
          aria-label="Toggle menu"
          aria-expanded={open}
          onClick={() => setOpen((o) => !o)}
        >
          <span />
          <span />
          <span />
        </button>

        <nav className={`nav ${open ? 'nav-open' : ''}`} aria-label="Main">
          {links.map((l) => (
            <NavLink key={l.to} to={l.to} end={l.end} onClick={close}>
              {l.label}
            </NavLink>
          ))}
          <Link to="/products" className="nav-search" aria-label="Search the shop" onClick={close}>
            <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
              <circle cx="11" cy="11" r="6.5" fill="none" stroke="currentColor" strokeWidth="2" />
              <path d="M16 16l4.5 4.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
          </Link>
          <span className="nav-divider" />
          {user ? (
            <>
              <span className="nav-user">Hi, {user.first_name}</span>
              <button
                className="btn btn-small btn-secondary"
                onClick={() => {
                  close()
                  logout()
                }}
              >
                Log Out
              </button>
            </>
          ) : (
            <>
              <NavLink to="/login" onClick={close}>
                Log In
              </NavLink>
              <Link to="/create-account" className="btn btn-small" onClick={close}>
                Create Account
              </Link>
            </>
          )}
        </nav>
      </div>
    </header>
  )
}
