/**
 * Lets any part of the page open the shopping assistant, optionally asking a question straight away
 * (e.g. the home page's sample questions or a product page's "Ask about this product").
 */
const OPEN_CHAT = 'campus-customs:open-chat'

export function openChat(message?: string) {
  window.dispatchEvent(new CustomEvent(OPEN_CHAT, { detail: { message } }))
}

export function onOpenChat(handler: (message?: string) => void): () => void {
  const listener = (e: Event) => handler((e as CustomEvent<{ message?: string }>).detail?.message)
  window.addEventListener(OPEN_CHAT, listener)
  return () => window.removeEventListener(OPEN_CHAT, listener)
}
