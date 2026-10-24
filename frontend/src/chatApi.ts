import { IS_STATIC } from './api'

export interface ChatProduct {
  product_id: string
  name: string
  price: number
  image_url: string
}

/** A product the assistant found, shown in the results panel on the page. */
export interface ChatResult {
  product_id: string
  name: string
  garment_type: string
  price: number
  image_url: string
  description: string
  sold_out: boolean
}

export interface ChatMessage {
  role: 'user' | 'assistant'
  content: string
  products?: ChatProduct[]
  results?: ChatResult[]
  /** True for messages the site shows when something went wrong; never sent to the assistant. */
  error?: boolean
}

/** A search matched more products than the page shows. */
export interface MoreResults {
  total: number
  /** The same search on the Products page. */
  link: string
}

export interface ChatReply {
  reply: string
  products: ChatProduct[]
  results: ChatResult[]
  more_results?: MoreResults | null
}

const MAX_HISTORY = 20

export const PREVIEW_MESSAGE =
  "The shopping assistant needs the Campus Customs server, so it isn't available in this preview."

/** Sends a message (plus recent conversation, for guests) and returns the assistant's reply. */
export async function sendChatMessage(message: string, earlier: ChatMessage[]): Promise<ChatReply> {
  if (IS_STATIC) throw new Error(PREVIEW_MESSAGE)
  const history = earlier
    .filter((m) => !m.error)
    .slice(-MAX_HISTORY)
    .map(({ role, content }) => ({ role, content }))
  const res = await fetch('/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'same-origin',
    body: JSON.stringify({ message, history }),
  })
  if (!res.ok) {
    const detail = (await res.json().catch(() => null))?.detail
    throw new Error(
      typeof detail === 'string' ? detail : "Sorry, I couldn't reach the assistant. Please try again.",
    )
  }
  return (await res.json()) as ChatReply
}

/** The logged-in customer's saved conversation (empty for guests). */
export async function fetchChatHistory(): Promise<ChatMessage[]> {
  if (IS_STATIC) return []
  const res = await fetch('/api/chat/history', { credentials: 'same-origin' })
  return res.ok ? ((await res.json()) as ChatMessage[]) : []
}
