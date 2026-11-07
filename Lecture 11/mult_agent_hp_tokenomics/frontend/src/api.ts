import type { ChatResult, ProgressEvent, SpecialistMeta } from './types'

const API_BASE = (import.meta.env.VITE_API_BASE as string | undefined)?.replace(/\/$/, '') || ''

async function apiFetch(path: string, init?: RequestInit) {
  const res = await fetch(`${API_BASE}${path}`, init)
  if (!res.ok) {
    const text = await res.text()
    throw new Error(text || `HTTP ${res.status}`)
  }
  return res
}

export async function fetchHealth(): Promise<{ ok: boolean; boss?: string; portkey_key_set?: boolean }> {
  const res = await apiFetch('/api/health')
  return res.json()
}

export async function fetchRoster(): Promise<{ boss: string; specialists: SpecialistMeta[] }> {
  const res = await apiFetch('/api/roster')
  return res.json()
}

export interface ModelOption {
  id: string
  label: string
  input: number
  output: number
}

export const FALLBACK_MODELS: ModelOption[] = [
  { id: 'gpt-6-luna', label: 'GPT-6 Luna', input: 0.1, output: 0.5 },
  { id: 'gpt-6-sol', label: 'GPT-6 Sol', input: 2, output: 10 },
]

export async function fetchModels(): Promise<{ default_model: string; default_budget_usd: number; models: ModelOption[] }> {
  const res = await apiFetch('/api/models')
  return res.json()
}

export async function streamChat(
  message: string,
  model: string,
  budgetUsd: number,
  onEvent: (ev: ProgressEvent) => void,
): Promise<ChatResult> {
  const res = await fetch(`${API_BASE}/api/chat/stream`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message, model, budget_usd: budgetUsd }),
  })
  if (!res.ok || !res.body) {
    const text = await res.text()
    throw new Error(text || `HTTP ${res.status}`)
  }

  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let finalResult: ChatResult | null = null

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    const parts = buffer.split('\n\n')
    buffer = parts.pop() || ''
    for (const block of parts) {
      const dataLine = block.split('\n').find((l) => l.startsWith('data: '))
      if (!dataLine) continue
      const payload = JSON.parse(dataLine.slice(6)) as ProgressEvent
      onEvent(payload)
      if (payload.type === 'final') {
        finalResult = payload.data as unknown as ChatResult
      }
      if (payload.type === 'error') {
        finalResult = {
          answer: String((payload.data as { answer?: string }).answer || 'Error'),
          delegations: ((payload.data as { delegations?: ChatResult['delegations'] }).delegations) || [],
          boss_name: String((payload.data as { boss_name?: string }).boss_name || 'Headmaster Labubledore'),
        }
      }
    }
  }

  if (!finalResult) {
    throw new Error('Stream ended without a final answer')
  }
  return finalResult
}
