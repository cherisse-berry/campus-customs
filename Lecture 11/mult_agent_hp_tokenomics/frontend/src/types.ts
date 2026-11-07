export type AgentStatus = 'idle' | 'thinking' | 'done' | 'error'

export interface SpecialistMeta {
  book_number: number
  title: string
  short: string
  specialty: string
  accent: string
  house_hint: string
  page_count?: number
  token_count?: number
}

export interface Delegation {
  agent: string
  book_number: number
  book_title: string
  question: string
  reply: string
  status: 'pending' | 'running' | 'done' | 'error'
}

export interface ChatResult {
  answer: string
  delegations: Delegation[]
  trace?: unknown[]
  boss_name: string
}

export interface ProgressEvent {
  type: string
  data: Record<string, unknown>
}
