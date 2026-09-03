const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";

type ApiError = { error?: string };

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...init,
    headers: { "content-type": "application/json", ...(init?.headers ?? {}) },
    cache: "no-store",
  });

  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as ApiError;
    throw new Error(body.error ?? `REQUEST_FAILED_${response.status}`);
  }
  return response.json() as Promise<T>;
}

export type AuthUser = {
  id: string;
  email: string | null;
  phone: string | null;
  firstName: string;
  lastName: string;
  preferredLanguage: string;
  role: string;
  status: string;
};

export type LoginResponse = {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  user: AuthUser;
};

export type Order = {
  id: string;
  serviceType: string;
  status: string;
  pickupAddress: string;
  deliveryAddress?: string | null;
  currency: string;
  budgetMinor?: string | null;
  createdAt: string;
};

export async function login(identifier: string, password: string) {
  return request<LoginResponse>("/v1/auth/login", {
    method: "POST",
    body: JSON.stringify({ identifier, password }),
  });
}

export async function register(input: { email: string; password: string; firstName: string; lastName: string }) {
  return request<{ user: AuthUser }>("/v1/auth/register", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export async function createOrder(accessToken: string, input: {
  serviceType: string;
  pickupAddress: string;
  deliveryAddress?: string;
}) {
  return request<{ order: Order }>("/v1/orders", {
    method: "POST",
    headers: { authorization: `Bearer ${accessToken}` },
    body: JSON.stringify(input),
  });
}

export async function listOrders(accessToken: string) {
  return request<{ orders: Order[] }>("/v1/orders", {
    headers: { authorization: `Bearer ${accessToken}` },
  });
}
