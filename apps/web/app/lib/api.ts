const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";
type ApiError = { error?: string };
type RequestOptions = RequestInit & { retryOn401?: boolean };
async function request<T>(path: string, init?: RequestOptions): Promise<T> {
  const { retryOn401 = true, ...fetchInit } = init ?? {};
  const response = await fetch(`${API_BASE_URL}${path}`, { ...fetchInit, headers: { "content-type": "application/json", ...(fetchInit.headers ?? {}) }, cache: "no-store" });
  if (response.status === 401 && retryOn401 && typeof window !== "undefined") {
    const refreshToken = window.localStorage.getItem("yuklab_refresh_token");
    if (refreshToken && path !== "/v1/auth/refresh") {
      try {
        const refreshed = await refresh(refreshToken);
        window.localStorage.setItem("yuklab_access_token", refreshed.accessToken);
        window.localStorage.setItem("yuklab_refresh_token", refreshed.refreshToken);
        const headers = new Headers(fetchInit.headers); headers.set("authorization", `Bearer ${refreshed.accessToken}`);
        return request<T>(path, { ...fetchInit, headers, retryOn401: false });
      } catch { window.localStorage.removeItem("yuklab_access_token"); window.localStorage.removeItem("yuklab_refresh_token"); window.localStorage.removeItem("yuklab_user_role"); }
    }
  }
  if (!response.ok) { const body = (await response.json().catch(() => ({}))) as ApiError; throw new Error(body.error ?? `REQUEST_FAILED_${response.status}`); }
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}
export type AuthUser = { id: string; email: string | null; phone: string | null; firstName: string; lastName: string; preferredLanguage: string; role: string; status: string };
export type LoginResponse = { accessToken: string; refreshToken: string; expiresIn: number; user: AuthUser };
export type OrderRequirements = { weightKg?: number; volumeM3?: number; vehicleType?: string; vehicleSubtype?: string; refrigerated?: boolean; loadType?: string; fragile?: boolean; notes?: string };
export type Order = { id: string; serviceType: string; status: string; pickupAddress: string; deliveryAddress?: string | null; pickupLat?: string | null; pickupLng?: string | null; deliveryLat?: string | null; deliveryLng?: string | null; scheduledAt?: string | null; budgetMinor?: string | null; currency: string; urgency?: number; payload?: OrderRequirements | null; createdAt: string };
export type Offer = { id: string; orderId: string; providerId: string; amountMinor: string; currency: string; etaMinutes?: number | null; note?: string | null; status: string; expiresAt?: string | null; createdAt: string; provider?: { id: string; firstName: string; lastName: string; role: string }; order?: Pick<Order, "id" | "serviceType" | "status" | "pickupAddress" | "deliveryAddress" | "payload"> };
export type Vehicle = { id: string; ownerId: string; type: string; subtype?: string | null; plateNumber?: string | null; capacityKg?: string | null; volumeM3?: string | null; refrigerated: boolean; active: boolean; createdAt: string; updatedAt: string };
export async function login(identifier: string, password: string) { const result = await request<LoginResponse>("/v1/auth/login", { method: "POST", body: JSON.stringify({ identifier, password }) }); if (typeof window !== "undefined") { window.localStorage.setItem("yuklab_access_token", result.accessToken); window.localStorage.setItem("yuklab_refresh_token", result.refreshToken); window.localStorage.setItem("yuklab_user_role", result.user.role); } return result; }
export async function register(input: { email: string; password: string; firstName: string; lastName: string }) { return request<{ user: AuthUser }>("/v1/auth/register", { method: "POST", body: JSON.stringify(input) }); }
export async function refresh(refreshToken: string) { return request<{ accessToken: string; refreshToken: string; expiresIn: number }>("/v1/auth/refresh", { method: "POST", body: JSON.stringify({ refreshToken }), retryOn401: false }); }
export async function logout(refreshToken: string) { return request<void>("/v1/auth/logout", { method: "POST", body: JSON.stringify({ refreshToken }) }); }
export async function becomeProvider(accessToken: string, category = "GENERAL") { return request<{ user: AuthUser; provider: { category: string; isOnline: boolean; isAvailable: boolean } }>("/v1/auth/become-provider", { method: "POST", headers: { authorization: `Bearer ${accessToken}` }, body: JSON.stringify({ category }) }); }
function auth(accessToken: string): RequestInit { return { headers: { authorization: `Bearer ${accessToken}` } }; }
export async function createOrder(accessToken: string, input: { serviceType: string; pickupAddress: string; deliveryAddress?: string; pickupLat?: number; pickupLng?: number; deliveryLat?: number; deliveryLng?: number; scheduledAt?: string; budgetMinor?: number; currency?: string; urgency?: number; payload?: OrderRequirements }) { return request<{ order: Order }>("/v1/orders", { ...auth(accessToken), method: "POST", body: JSON.stringify(input) }); }
export async function listOrders(accessToken: string) { return request<{ orders: Order[] }>("/v1/orders", auth(accessToken)); }
export async function listOrderOffers(accessToken: string, orderId: string) { return request<{ offers: Offer[] }>(`/v1/orders/${orderId}/offers`, auth(accessToken)); }
export async function acceptOffer(accessToken: string, orderId: string, offerId: string) { return request<{ order: Order; offer: Offer }>(`/v1/orders/${orderId}/offers/${offerId}/accept`, { ...auth(accessToken), method: "POST" }); }
export async function listProviderOrders(accessToken: string) { return request<{ orders: Order[] }>("/v1/provider/orders", auth(accessToken)); }
export async function listProviderOffers(accessToken: string) { return request<{ offers: Offer[] }>("/v1/provider/offers", auth(accessToken)); }
export async function createOffer(accessToken: string, orderId: string, input: { amountMinor: number; etaMinutes?: number; note?: string }) { return request<{ offer: Offer }>(`/v1/orders/${orderId}/offers`, { ...auth(accessToken), method: "POST", body: JSON.stringify(input) }); }
export async function listVehicles(accessToken: string) { return request<{ vehicles: Vehicle[] }>("/v1/vehicles", auth(accessToken)); }
export async function createVehicle(accessToken: string, input: { type: string; subtype?: string; plateNumber?: string; capacityKg?: number; volumeM3?: number; refrigerated?: boolean }) { return request<{ vehicle: Vehicle }>("/v1/vehicles", { ...auth(accessToken), method: "POST", body: JSON.stringify(input) }); }
export async function updateVehicle(accessToken: string, id: string, input: { type: string; subtype?: string; plateNumber?: string; capacityKg?: number; volumeM3?: number; refrigerated?: boolean; active?: boolean }) { return request<{ vehicle: Vehicle }>(`/v1/vehicles/${id}`, { ...auth(accessToken), method: "PATCH", body: JSON.stringify(input) }); }
export async function deactivateVehicle(accessToken: string, id: string) { return request<void>(`/v1/vehicles/${id}`, { ...auth(accessToken), method: "DELETE" }); }
