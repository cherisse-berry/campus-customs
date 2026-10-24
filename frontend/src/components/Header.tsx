import { useState } from 'react'
import { Link, NavLink } from 'react-router-dom'

const links = [
  { to: '/', label: 'Home', end: true },
  { to: '/products', label: 'Shop' },
  { to: '/about', label: 'About Us' },
]

export default function Header() {
  const [open, setOpen] = useState(false)
  const close = () => setOpen(false)

  return (
    <header className="site-header">
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
          <span className="nav-divider" />
          <NavLink to="/login" onClick={close}>
            Log In
          </NavLink>
          <Link to="/create-account" className="btn btn-small" onClick={close}>
            Create Account
          </Link>
        </nav>
      </div>
    </header>
  )
}
