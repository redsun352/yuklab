const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";
type ApiError = { error?: string };
async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE_URL}${path}`, { ...init, headers: { "content-type": "application/json", ...(init?.headers ?? {}) }, cache: "no-store" });
  if (!response.ok) { const body = (await response.json().catch(() => ({}))) as ApiError; throw new Error(body.error ?? `REQUEST_FAILED_${response.status}`); }
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}
export type AuthUser = { id: string; email: string | null; phone: string | null; firstName: string; lastName: string; preferredLanguage: string; role: string; status: string };
export type LoginResponse = { accessToken: string; refreshToken: string; expiresIn: number; user: AuthUser };
export type Order = { id: string; serviceType: string; status: string; pickupAddress: string; deliveryAddress?: string | null; pickupLat?: string | null; pickupLng?: string | null; deliveryLat?: string | null; deliveryLng?: string | null; scheduledAt?: string | null; budgetMinor?: string | null; currency: string; urgency?: number; createdAt: string };
export type Offer = { id: string; orderId: string; providerId: string; amountMinor: string; currency: string; etaMinutes?: number | null; note?: string | null; status: string; expiresAt?: string | null; createdAt: string; provider?: { id: string; firstName: string; lastName: string; role: string }; order?: Pick<Order, "id" | "serviceType" | "status" | "pickupAddress" | "deliveryAddress"> };
export async function login(identifier: string, password: string) { return request<LoginResponse>("/v1/auth/login", { method: "POST", body: JSON.stringify({ identifier, password }) }); }
export async function register(input: { email: string; password: string; firstName: string; lastName: string }) { return request<{ user: AuthUser }>("/v1/auth/register", { method: "POST", body: JSON.stringify(input) }); }
export async function refresh(refreshToken: string) { return request<{ accessToken: string; refreshToken: string; expiresIn: number }>("/v1/auth/refresh", { method: "POST", body: JSON.stringify({ refreshToken }) }); }
export async function logout(refreshToken: string) { return request<void>("/v1/auth/logout", { method: "POST", body: JSON.stringify({ refreshToken }) }); }
export async function createOrder(accessToken: string, input: { serviceType: string; pickupAddress: string; deliveryAddress?: string }) { return request<{ order: Order }>("/v1/orders", { method: "POST", headers: { authorization: `Bearer ${accessToken}` }, body: JSON.stringify(input) }); }
export async function listOrders(accessToken: string) { return request<{ orders: Order[] }>("/v1/orders", { headers: { authorization: `Bearer ${accessToken}` } }); }
export async function listOrderOffers(accessToken: string, orderId: string) { return request<{ offers: Offer[] }>(`/v1/orders/${orderId}/offers`, { headers: { authorization: `Bearer ${accessToken}` } }); }
export async function acceptOffer(accessToken: string, orderId: string, offerId: string) { return request<{ order: Order; offer: Offer }>(`/v1/orders/${orderId}/offers/${offerId}/accept`, { method: "POST", headers: { authorization: `Bearer ${accessToken}` } }); }
export async function listProviderOrders(accessToken: string) { return request<{ orders: Order[] }>("/v1/provider/orders", { headers: { authorization: `Bearer ${accessToken}` } }); }
export async function listProviderOffers(accessToken: string) { return request<{ offers: Offer[] }>("/v1/provider/offers", { headers: { authorization: `Bearer ${accessToken}` } }); }
export async function createOffer(accessToken: string, orderId: string, input: { amountMinor: number; etaMinutes?: number; note?: string }) { return request<{ offer: Offer }>(`/v1/orders/${orderId}/offers`, { method: "POST", headers: { authorization: `Bearer ${accessToken}` }, body: JSON.stringify(input) }); }
