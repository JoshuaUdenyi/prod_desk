/**
 * The one place that talks to the Worker.
 *
 * Every call returns the DTO from `@shared/types`, and every failure arrives as
 * an `ApiError` carrying the per-field messages the server already produced, so
 * forms can highlight the offending input rather than showing a bare toast.
 */

import type {
  ApiErrorBody,
  CostCategory,
  DashboardDto,
  LineKind,
  MarginPreset,
  PriceBase,
  ProjectDetailDto,
  ProjectStatus,
  ProjectSummaryDto,
  QuotationDto,
  QuotationLayout,
  SessionUser,
  SettingsDto,
  SettingsUpdate,
} from '@shared/types';

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly fields: Record<string, string>;

  constructor(status: number, code: string, message: string, fields: Record<string, string> = {}) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.fields = fields;
  }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.body !== undefined && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }

  let response: Response;
  try {
    response = await fetch(`/api${path}`, { ...init, headers, credentials: 'same-origin' });
  } catch {
    throw new ApiError(0, 'network', 'Could not reach the server. Check your connection.');
  }

  if (response.status === 204) return undefined as T;

  const contentType = response.headers.get('Content-Type') ?? '';
  const payload: unknown = contentType.includes('application/json') ? await response.json() : null;

  if (!response.ok) {
    const body = payload as ApiErrorBody | null;
    throw new ApiError(
      response.status,
      body?.error?.code ?? 'error',
      body?.error?.message ?? `Request failed (${response.status})`,
      body?.error?.fields ?? {},
    );
  }

  return payload as T;
}

const body = (value: unknown) => JSON.stringify(value);

const post = <T>(path: string, value: unknown = {}) => request<T>(path, { method: 'POST', body: body(value) });
const patch = <T>(path: string, value: unknown) => request<T>(path, { method: 'PATCH', body: body(value) });
const put = <T>(path: string, value: unknown) => request<T>(path, { method: 'PUT', body: body(value) });
const del = <T>(path: string) => request<T>(path, { method: 'DELETE' });

function query(params: Record<string, string | null | undefined>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== null && value !== undefined && value !== '') search.set(key, value);
  }
  const encoded = search.toString();
  return encoded ? `?${encoded}` : '';
}

// ---------------------------------------------------------------------------
// Request shapes
// ---------------------------------------------------------------------------

export interface LoginInput {
  email: string;
  password: string;
  turnstileToken?: string;
}

export interface SetupInput {
  name: string;
  email: string;
  password: string;
  companyName?: string;
}

export interface ProjectInput {
  name: string;
  clientName: string;
  clientContact?: string;
  clientEmail?: string;
  eventType?: string;
  location?: string;
  eventDate?: string | null;
  productionDays?: number;
  description?: string;
  targetMarginPreset?: MarginPreset;
  targetMarginBp?: number;
  priceBase?: PriceBase;
  contingencyBp?: number;
  overheadMethod?: 'none' | 'fixed' | 'percent';
  overheadFixedKobo?: number;
  overheadPercentBp?: number;
  vatRateBp?: number;
  status?: ProjectStatus;
}

export interface CostLineInput {
  category: CostCategory;
  kind?: LineKind;
  description: string;
  quantityMilli: number;
  unitRateKobo: number;
  daysMilli: number;
  additionalKobo: number;
  supplier?: string;
  notes?: string;
  sortOrder?: number;
}

export interface PricingInput {
  targetMarginPreset?: MarginPreset;
  targetMarginBp?: number;
  priceBase?: PriceBase;
  /** null clears the manual override and returns to the recommended price. */
  sellingPriceNetKobo?: number | null;
  contingencyBp?: number;
  overheadMethod?: 'none' | 'fixed' | 'percent';
  overheadFixedKobo?: number;
  overheadPercentBp?: number;
  vatRateBp?: number;
}

export interface ActualInput {
  costLineId?: string | null;
  category: CostCategory;
  description: string;
  amountKobo: number;
  incurredOn?: string | null;
  supplier?: string;
  notes?: string;
}

export interface PaymentInput {
  amountKobo: number;
  paidOn: string;
  method?: string;
  reference?: string;
  notes?: string;
}

// ---------------------------------------------------------------------------
// Endpoints
// ---------------------------------------------------------------------------

export const api = {
  auth: {
    status: () => request<{ needsSetup: boolean; turnstileSiteKey: string | null }>('/auth/status'),
    setup: (input: SetupInput) => post<{ user: SessionUser }>('/auth/setup', input),
    login: (input: LoginInput) => post<{ user: SessionUser }>('/auth/login', input),
    logout: () => post<{ ok: true }>('/auth/logout'),
    me: () => request<{ user: SessionUser }>('/auth/me'),
    users: () => request<{ users: SessionUser[] }>('/auth/users'),
    createUser: (input: { name: string; email: string; password: string; role: 'owner' | 'finance' }) =>
      post<{ user: SessionUser }>('/auth/users', input),
    updateUser: (id: string, input: { isActive?: boolean; name?: string }) =>
      patch<{ ok: true }>(`/auth/users/${id}`, input),
  },

  dashboard: (range: { from?: string | null; to?: string | null } = {}) =>
    request<DashboardDto>(`/dashboard${query(range)}`),

  projects: {
    list: (filters: { from?: string | null; to?: string | null; status?: string | null } = {}) =>
      request<{ projects: ProjectSummaryDto[] }>(`/projects${query(filters)}`),
    get: (id: string) => request<ProjectDetailDto>(`/projects/${id}`),
    create: (input: ProjectInput) => post<ProjectDetailDto>('/projects', input),
    update: (id: string, input: Partial<ProjectInput>) => patch<ProjectDetailDto>(`/projects/${id}`, input),
    remove: (id: string) => del<{ ok: true }>(`/projects/${id}`),

    addCostLine: (id: string, input: CostLineInput) => post<ProjectDetailDto>(`/projects/${id}/cost-lines`, input),
    updateCostLine: (id: string, lineId: string, input: Partial<CostLineInput>) =>
      patch<ProjectDetailDto>(`/projects/${id}/cost-lines/${lineId}`, input),
    removeCostLine: (id: string, lineId: string) =>
      del<ProjectDetailDto>(`/projects/${id}/cost-lines/${lineId}`),

    updatePricing: (id: string, input: PricingInput) => patch<ProjectDetailDto>(`/projects/${id}/pricing`, input),
    approve: (id: string, reason: string) => post<ProjectDetailDto>(`/projects/${id}/approval`, { reason }),

    addActual: (id: string, input: ActualInput) => post<ProjectDetailDto>(`/projects/${id}/actuals`, input),
    updateActual: (id: string, actualId: string, input: Partial<ActualInput>) =>
      patch<ProjectDetailDto>(`/projects/${id}/actuals/${actualId}`, input),
    removeActual: (id: string, actualId: string) => del<ProjectDetailDto>(`/projects/${id}/actuals/${actualId}`),

    addPayment: (id: string, input: PaymentInput) => post<ProjectDetailDto>(`/projects/${id}/payments`, input),
    removePayment: (id: string, paymentId: string) =>
      del<ProjectDetailDto>(`/projects/${id}/payments/${paymentId}`),
  },

  quotations: {
    list: (projectId: string) => request<{ quotations: QuotationDto[] }>(`/quotations${query({ projectId })}`),
    get: (id: string) => request<{ quotation: QuotationDto }>(`/quotations/${id}`),
    create: (input: { projectId: string; layout?: QuotationLayout; clientNotes?: string }) =>
      post<{ quotation: QuotationDto }>('/quotations', input),
    issue: (id: string, validUntil?: string | null) =>
      post<{ quotation: QuotationDto }>(`/quotations/${id}/issue`, { validUntil: validUntil ?? null }),
    setStatus: (id: string, status: 'accepted' | 'declined') =>
      post<{ quotation: QuotationDto }>(`/quotations/${id}/status`, { status }),
    remove: (id: string) => del<void>(`/quotations/${id}`),
  },

  settings: {
    get: () => request<{ settings: SettingsDto }>('/settings'),
    update: (input: SettingsUpdate) => put<{ settings: SettingsDto }>('/settings', input),
    uploadLogo: async (file: File) => {
      const form = new FormData();
      form.append('logo', file);
      return request<{ ok: true; logoUrl: string }>('/settings/logo', { method: 'POST', body: form });
    },
  },
};
