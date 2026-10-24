import { Link } from 'react-router-dom'

const values = [
  {
    title: 'Made for Yale',
    text: 'Every design celebrates Yale: residential colleges, professional schools, varsity sports and the Bulldog spirit.',
  },
  {
    title: 'Quality you can feel',
    text: 'Heavyweight fleece, soft tri-blends and classic reverse-weave from trusted brands like Champion and Brooks Brothers.',
  },
  {
    title: 'For the whole family',
    text: 'From first-years to grandparents, we have styles for everyone who calls Yale home or cheers from the stands.',
  },
]

export default function About() {
  return (
    <>
      <section className="page-hero">
        <div className="container">
          <p className="eyebrow">About us</p>
          <h1>Bulldog pride, made to wear.</h1>
          <p className="hero-lead">
            Campus Customs is a New Haven apparel shop for the Yale community. We bring together the styles
            students and alumni love, from college crewnecks to game-day tees.
          </p>
        </div>
      </section>

      <section className="section container">
        <div className="values">
          {values.map((v) => (
            <div key={v.title} className="value-card">
              <h3>{v.title}</h3>
              <p>{v.text}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="section container about-story">
        <h2>Our story</h2>
        <p>
          We started Campus Customs because finding great Yale apparel shouldn't be hard. Our catalogue covers
          Yale's residential colleges, Yale's professional schools and more than fifteen varsity sports, so there's
          something for every corner of campus.
        </p>
        <p>
          Have a question about sizing or stock? Use the chat in the corner of any page. Our assistant will soon be
          able to help you find the perfect fit.
        </p>
        <Link to="/products" className="btn">Shop the collection</Link>
      </section>
    </>
  )
}
