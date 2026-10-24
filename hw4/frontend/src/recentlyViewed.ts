import { useEffect, useState } from 'react'

/**
 * Recently viewed products, remembered in this browser (localStorage), so it works for guests
 * too and nothing personal goes to the server. Only product IDs are stored; prices and stock
 * are always loaded fresh.
 */
const KEY = 'campus-customs:recently-viewed'
const CHANGED = 'campus-customs:recently-viewed-changed'
export const MAX_RECENT = 8

export function getRecentlyViewed(): string[] {
  try {
    const ids = JSON.parse(localStorage.getItem(KEY) ?? '[]')
    return Array.isArray(ids) ? ids.filter((id): id is string => typeof id === 'string').slice(0, MAX_RECENT) : []
  } catch {
    return [] // storage blocked (private mode) or unreadable: just show nothing
  }
}

function save(ids: string[]) {
  try {
    localStorage.setItem(KEY, JSON.stringify(ids))
  } catch {
    // Storage unavailable; the feature quietly does nothing.
  }
  window.dispatchEvent(new Event(CHANGED))
}

/** Move a product to the front of the list (most recent first). */
export function addRecentlyViewed(productId: string) {
  save([productId, ...getRecentlyViewed().filter((id) => id !== productId)].slice(0, MAX_RECENT))
}

export function clearRecentlyViewed() {
  save([])
}

/** The current list, kept up to date when it changes in this tab or another one. */
export function useRecentlyViewed(): string[] {
  const [ids, setIds] = useState(getRecentlyViewed)
  useEffect(() => {
    const update = () => setIds(getRecentlyViewed())
    window.addEventListener(CHANGED, update)
    window.addEventListener('storage', update)
    return () => {
      window.removeEventListener(CHANGED, update)
      window.removeEventListener('storage', update)
    }
  }, [])
  return ids
}
