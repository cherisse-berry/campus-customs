import { Link } from 'react-router-dom'

export default function Footer() {
  return (
    <footer className="site-footer">
      <div className="container footer-grid">
        <div>
          <p className="footer-brand">Campus Customs</p>
          <p className="muted-light">
            Yale apparel for students, alumni, family and fans. Designed with Bulldog pride in New Haven.
          </p>
        </div>
        <div>
          <p className="footer-heading">Shop</p>
          <ul>
            <li><Link to="/products?category=hoodies">Hoodies</Link></li>
            <li><Link to="/products?category=crewnecks">Crewnecks</Link></li>
            <li><Link to="/products?category=t-shirts">T-Shirts</Link></li>
            <li><Link to="/products?category=quarter-zips">Quarter-Zips</Link></li>
          </ul>
        </div>
        <div>
          <p className="footer-heading">Company</p>
          <ul>
            <li><Link to="/about">About Us</Link></li>
            <li><Link to="/login">Log In</Link></li>
            <li><Link to="/create-account">Create Account</Link></li>
          </ul>
        </div>
      </div>
      <div className="container footer-bottom">© {new Date().getFullYear()} Campus Customs. All rights reserved.</div>
    </footer>
  )
}
