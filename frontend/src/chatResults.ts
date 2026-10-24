import { createContext, useContext } from 'react'
import type { ChatResult, MoreResults } from './chatApi'

/** The products the assistant found for the customer's latest question, shown on the page. */
export interface ChatResultsSet {
  /** Changes for every new set, so the panel knows to reveal itself. */
  id: number
  question: string
  results: ChatResult[]
  more?: MoreResults | null
}

export interface ChatResultsState {
  current: ChatResultsSet | null
  /** Bumped when the panel should expand and scroll into view. */
  revealToken: number
  /** Show a new set of results. `reveal` scrolls the panel into view. */
  show: (question: string, results: ChatResult[], reveal: boolean, more?: MoreResults | null) => void
  /** Expand the panel and scroll to it. */
  reveal: () => void
  clear: () => void
}

export const ChatResultsContext = createContext<ChatResultsState | null>(null)

export function useChatResults(): ChatResultsState {
  const ctx = useContext(ChatResultsContext)
  if (!ctx) throw new Error('useChatResults must be used inside <ChatResultsProvider>')
  return ctx
}
