import type { AgentName } from './api'

export interface AgentMeta {
  name: AgentName
  label: string
  role: string
  /** CSS custom property holding the agent's color (defined in styles.css for light and dark). */
  color: string
  /** Short mark shown in the avatar. */
  mark: string
}

export const AGENTS: AgentMeta[] = [
  { name: 'boss', label: 'Boss', role: 'Coordinates the team and writes the plan', color: 'var(--agent-boss)', mark: 'B' },
  { name: 'inventory', label: 'Inventory', role: 'Stock, vendors and purchase requests', color: 'var(--agent-inventory)', mark: 'In' },
  { name: 'accounting', label: 'Accounting', role: 'Bills, cash, payments and pricing', color: 'var(--agent-accounting)', mark: 'Ac' },
  { name: 'facilities', label: 'Facilities', role: 'The lease and rent', color: 'var(--agent-facilities)', mark: 'Fa' },
  { name: 'customer_service', label: 'Customer Service', role: 'Drafts to customers (never sent)', color: 'var(--agent-customer-service)', mark: 'CS' },
]

export const AGENT_BY_NAME: Record<string, AgentMeta> = Object.fromEntries(AGENTS.map((a) => [a.name, a]))

export function agentMeta(name: string | null | undefined): AgentMeta | undefined {
  return name ? AGENT_BY_NAME[name] : undefined
}
