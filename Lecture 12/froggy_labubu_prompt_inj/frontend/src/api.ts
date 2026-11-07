export type ChatResult = {
  reply: string
  reasoning: string[]
  reasoning_tokens: number
  input_tokens: number
  output_tokens: number
  tools: string[]
  outbox: string[]
}

export type PagesInfo = { pages: string[]; models: string[]; default_model: string }

async function asJson<T>(res: Response): Promise<T> {
  if (!res.ok) {
    let detail = `${res.status} ${res.statusText}`
    try {
      const body = await res.json()
      if (body?.detail) detail = String(body.detail)
    } catch {
      /* keep status text */
    }
    throw new Error(detail)
  }
  return res.json() as Promise<T>
}

export async function getPages(): Promise<PagesInfo> {
  return asJson<PagesInfo>(await fetch('/api/pages'))
}

export async function sendChat(body: {
  session_id: string
  page: string
  model: string
  message: string
}): Promise<ChatResult> {
  return asJson<ChatResult>(
    await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }),
  )
}

export async function resetChat(session_id: string): Promise<void> {
  await fetch('/api/reset', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ session_id }),
  })
}

export type Exploit = {
  page: string
  label: string
  level: 'clean' | 'blunt' | 'subtle'
  hiding: string
  snippet: string
  goal: string
  hijack_looks_like: string
  defense: string
}

export async function getExploits(): Promise<Exploit[]> {
  return (await asJson<{ exploits: Exploit[] }>(await fetch('/api/exploits'))).exploits
}
