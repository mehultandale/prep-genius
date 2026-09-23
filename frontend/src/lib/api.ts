'use client';

import type { KitDocument } from '@/types/kit';

/**
 * Tiny API client + auth session store (token in localStorage; httpOnly cookie
 * is also set server-side and used as fallback).
 */
const API = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';

let authToken: string | null = null;

export function setToken(token: string | null) {
  authToken = token;
  if (typeof window !== 'undefined') {
    if (token) window.localStorage.setItem('pg_token', token);
    else window.localStorage.removeItem('pg_token');
  }
}

export function getToken(): string | null {
  if (authToken) return authToken;
  if (typeof window !== 'undefined') {
    authToken = window.localStorage.getItem('pg_token');
  }
  return authToken;
}

export class ApiError extends Error {
  status: number;
  code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = getToken();
  const res = await fetch(`${API}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...init.headers,
    },
    credentials: 'include',
  });

  if (res.status === 401 && typeof window !== 'undefined') {
    setToken(null);
    if (!window.location.pathname.startsWith('/login')) {
      window.location.href = '/login';
    }
  }

  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new ApiError(
      res.status,
      body?.error?.code ?? 'REQUEST_FAILED',
      body?.error?.message ?? `Request failed (${res.status})`
    );
  }
  return body as T;
}

export const api = {
  get: <T>(path: string) => request<T>(path),
  post: <T>(path: string, data?: unknown) =>
    request<T>(path, { method: 'POST', body: data ? JSON.stringify(data) : undefined }),
  patch: <T>(path: string, data: unknown) =>
    request<T>(path, { method: 'PATCH', body: JSON.stringify(data) }),
  delete: <T>(path: string) => request<T>(path, { method: 'DELETE' }),
};

// ── Auth ──────────────────────────────────────────────────────────────────────
export const auth = {
  register: (email: string, password: string) =>
    api.post<{ token: string; user: { id: string; email: string } }>('/api/auth/register', { email, password }),
  login: (email: string, password: string) =>
    api.post<{ token: string; user: { id: string; email: string } }>('/api/auth/login', { email, password }),
  logout: () => api.post('/api/auth/logout'),
  me: () => api.get<{ user: { id: string; email: string } }>('/api/auth/me'),
};

// ── Kits ──────────────────────────────────────────────────────────────────────
export const kits = {
  create: (jd: string, company_url: string, days: number) =>
    api.post<{ id: string }>('/api/kits', { jd, company_url, days }),
  createBatch: (cases: Array<{ id?: string; jd: string; company_url: string; days: number }>) =>
    api.post<{ batchId: string; kits: Array<{ id: string; kitId: string }> }>('/api/kits/batch', { cases }),
  list: () => api.get<{ kits: KitDocument[] }>('/api/kits'),
  get: (id: string) => api.get<{ kit: KitDocument }>(`/api/kits/${id}`),
  progress: (id: string) =>
    api.get<{ status: KitDocument['status']; phase: string; progress: KitDocument['progress']; error: KitDocument['error'] }>(
      `/api/kits/${id}/progress`
    ),
};
