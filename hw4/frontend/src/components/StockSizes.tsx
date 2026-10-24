import { stockLabel, stockLevel } from '../stock'
import type { SizeStock } from '../types'

/** A compact row of sizes on a product card: available, nearly gone or sold out (struck through). */
export default function StockSizes({ stock }: { stock: SizeStock[] }) {
  return (
    <ul className="stock-sizes" aria-label="Sizes">
      {stock.map((s) => (
        <li
          key={s.size}
          className={`stock-size stock-size-${stockLevel(s.quantity)}`}
          title={`${s.size}: ${stockLabel(s.quantity)}`}
          aria-label={`${s.size}: ${stockLabel(s.quantity)}`}
        >
          {s.size}
        </li>
      ))}
    </ul>
  )
}
