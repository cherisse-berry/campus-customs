// Typed client for the Campus Customs FastAPI backend (hw5/backend/main.py).

export const API_URL: string = (import.meta.env.VITE_API_URL as string | undefined) ?? 'http://localhost:8000'

export type AgentName = 'boss' | 'inventory' | 'accounting' | 'facilities' | 'customer_service'

export interface Health {
  status: string
  model: string
  portkey_key_configured: boolean
  working_database_present: boolean
  busy: string | null
}

export interface Ticket {
  id: number
  type: 'customer_order' | 'rent_notice' | 'price_override' | string
  requester: string
  subject: string
  sku: string | null
  size: string | null
  qty: number | null
  status: string
  created_at: string
  requester_is_customer: boolean
  agent_status: string
  latest_run_id: string | null
  pending_approvals: number
}

export interface TicketDetail {
  today: string
  requester_is_customer: boolean
  ticket: Omit<Ticket, 'requester_is_customer' | 'agent_status' | 'latest_run_id' | 'pending_approvals'> & { notes: string | null; invoice_id: number | null; lease_id: number | null }
  linked: {
    invoice?: { id: number; vendor: string; amount: number; still_owed: number; due_date: string; days_until_due: number; status: string; description: string }
    lease?: { id: number; landlord: string; monthly_rent: number; next_due: string; days_until_due: number; still_owed_for_next_due: number; space_name: string }
  }
}

export interface Usage { requests: number; tool_calls: number; input_tokens: number; output_tokens: number }

export interface Finding { fact: string; sources: string[] }
export interface DraftMessage { ticket_id: number; to: string; subject: string; body: string; sent: false }
export interface FollowUp { action: string; reason: string }

export interface Resolution {
  ticket_id: number
  status: 'needs_human_approval' | 'ready_for_review'
  summary: string
  agents_consulted: AgentName[]
  findings: Finding[]
  decisions: string[]
  payment_approvals: unknown[]
  discount_approvals: unknown[]
  purchase_approvals: unknown[]
  draft_messages: DraftMessage[]
  human_follow_ups: FollowUp[]
  unknowns: string[]
}

export interface Run {
  run_id: string
  ticket_id: number
  status: 'running' | 'finished' | 'stopped' | 'error'
  started_at: string
  finished_at?: string
  outcome?: string
  usage?: Usage
  delegations?: number
  error?: string
  resolution?: Resolution
}

export interface AgentReport {
  agent: AgentName
  summary: string
  findings: Finding[]
  decisions: string[]
  unknowns: string[]
}

export interface ActivityEvent {
  position: number
  categories: string[]
  summary: string
  id: string
  timestamp: string
  run_id: string | null
  ticket_id: number | null
  agent: AgentName | 'human' | null
  event: string
  // Present on some events:
  to?: AgentName
  task?: string
  reply_to?: AgentName
  report?: AgentReport
  tool?: string
  arguments?: Record<string, unknown>
  result?: unknown
  error?: string
  problems?: string[]
  message?: DraftMessage
  decision?: string
  resolution?: Resolution
  outcome?: string
  usage?: Usage
  approval_type?: string
  follow_up?: FollowUp
}

export interface Activity { events: ActivityEvent[]; next: number; running: boolean }

export interface PaymentRequest {
  kind: 'invoice' | 'rent'; ref_id: number; payee: string; amount: number; account: string
  due_date: string; reason: string; cash_available: number; cash_after_payment: number; warnings: string[]
}
export interface PurchaseRequest {
  ticket_id: number; sku: string; size: string; qty: number; vendor_id: number; reason: string
  product_name: string; qty_in_stock: number; vendor_name: string; vendor_specialty: string; lead_days: number
  vendor_can_ship: boolean; unpaid_invoices: number[]; estimated_unit_cost: number; estimated_cost: number
  warnings: string[]
}
export interface DiscountOption { discount_percent: number; unit_price: number; total_price: number; total_profit: number; below_cost: boolean }
export interface DiscountRequest {
  ticket_id: number; customer: string; sku: string; size: string; qty: number; list_price: number; unit_cost: number
  total_at_list_price: number; qty_in_stock: number; break_even_discount_percent: number; facts_for_decision: string[]
  options_evaluated?: DiscountOption[]; recommended_discount_percent?: number | null; recommendation_reason?: string | null
}

export interface PaymentReview {
  check: { amount_on_file: number; cash_available: number; cash_after_payment: number; payee: string; due_date: string; days_until_due: number }
  still_owed: number
  warnings: string[]
  problems: string[]
  also_pending: string[]
  can_approve: boolean
  needs_confirmation: boolean
}
export interface PurchaseReview extends Omit<PurchaseRequest, 'ticket_id' | 'sku' | 'size' | 'qty' | 'vendor_id' | 'reason'> {
  needs_confirmation: boolean
  can_approve: boolean
  approval_effect: string
}

interface ApprovalBase { approval_id: string; ticket_id: number; run_id: string; timestamp: string }
export type Approval =
  | (ApprovalBase & { approval_type: 'payment'; request: PaymentRequest; review?: PaymentReview })
  | (ApprovalBase & { approval_type: 'purchase'; request: PurchaseRequest; review?: PurchaseReview })
  | (ApprovalBase & { approval_type: 'discount'; request: DiscountRequest; review?: undefined })

export type DecidedApproval = Approval & { decision: { approved: boolean; decided_by: string; timestamp: string } }

export interface Approvals { pending?: Approval[]; decided?: DecidedApproval[]; expired?: Approval[] }

export interface Cash {
  today: string
  checking_balance: number | null
  as_of: string | null
  payments_due: { kind: string; id: number; payee: string; description: string; amount: number; due_date: string; days_until_due: number; overdue: boolean }[]
  total_due: number
  cash_left_if_all_paid: number
  note: string
}

export class ApiError extends Error {
  constructor(public status: number, public body: Record<string, unknown>) {
    super(typeof body.detail === 'string' ? body.detail : `Request failed (${status})`)
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
  })
  const body = await res.json().catch(() => ({}))
  if (!res.ok) throw new ApiError(res.status, body)
  return body as T
}

export const api = {
  health: () => request<Health>('/api/health'),
  tickets: () => request<{ today: string; tickets: Ticket[] }>('/api/tickets'),
  ticket: (id: number) => request<TicketDetail>(`/api/tickets/${id}`),
  run: (id: number, requestedBy?: string) =>
    request<{ run_id: string; status: string }>(`/api/tickets/${id}/run`, {
      method: 'POST', body: JSON.stringify({ requested_by: requestedBy ?? null }),
    }),
  getRun: (runId: string) => request<Run>(`/api/runs/${runId}`),
  activity: (runId: string, since = 0) =>
    request<Activity>(`/api/activity?run_id=${encodeURIComponent(runId)}&since=${since}&limit=1000`),
  approvals: () => request<Approvals>('/api/approvals?status=all'),
  decide: (approvalId: string, body: {
    decision: 'approve' | 'reject'; decided_by: string; confirmed_warnings?: string[]; discount_percent?: number; note?: string
  }) => request<Record<string, unknown>>(`/api/approvals/${approvalId}`, { method: 'POST', body: JSON.stringify(body) }),
  cash: () => request<Cash>('/api/cash'),
}
