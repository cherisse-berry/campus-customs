import { useCallback, useMemo, useRef, useState, type ReactNode } from 'react'
import type { ChatResult, MoreResults } from '../chatApi'
import { ChatResultsContext, type ChatResultsSet, type ChatResultsState } from '../chatResults'

export default function ChatResultsProvider({ children }: { children: ReactNode }) {
  const [current, setCurrent] = useState<ChatResultsSet | null>(null)
  const [revealToken, setRevealToken] = useState(0)
  const nextId = useRef(1)

  const reveal = useCallback(() => setRevealToken((t) => t + 1), [])

  const show = useCallback(
    (question: string, results: ChatResult[], shouldReveal: boolean, more?: MoreResults | null) => {
      setCurrent({ id: nextId.current++, question, results, more })
      if (shouldReveal) reveal()
    },
    [reveal],
  )

  const clear = useCallback(() => setCurrent(null), [])

  const value = useMemo<ChatResultsState>(
    () => ({ current, revealToken, show, reveal, clear }),
    [current, revealToken, show, reveal, clear],
  )

  return <ChatResultsContext.Provider value={value}>{children}</ChatResultsContext.Provider>
}
