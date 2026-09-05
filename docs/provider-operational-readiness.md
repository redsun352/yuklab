# Provider Operational Readiness

## Provider lifecycle

1. A CUSTOMER can become either a DRIVER or SERVICE_PROVIDER.
2. SERVICE_PROVIDER onboarding persists a `ServiceProvider` profile and category.
3. DRIVER onboarding persists a `DriverProfile`.
4. Provider profile availability is invariant: `isAvailable=true` implies `isOnline=true`.
5. Active vehicles are owned by the authenticated provider and are eligible for matching.
6. Live provider location is stored in the realtime tracking state and expires after the configured TTL.
7. Matching combines provider role/profile, category, service radius, vehicle requirements, distance, rating, reliability and route ETA.
8. Accepted orders assign the selected provider and the same provider identity is used by operational order transitions and tracking authorization.

## Operational API

- `POST /v1/auth/become-provider`
- `GET /v1/providers/me`
- `PATCH /v1/providers/me`
- `GET /v1/vehicles`
- `POST /v1/vehicles`
- `PATCH /v1/vehicles/:id`
- `DELETE /v1/vehicles/:id`
- `POST /v1/tracking/location`
- `GET /v1/tracking/orders/:orderId/location`
- `GET /v1/matching/orders/:orderId`

## Availability invariant

A provider cannot be available while offline. Sending `{ "isOnline": false, "isAvailable": true }` results in `isAvailable=false`.

## Matching prerequisites

A provider must be ACTIVE, online, available, within the configured matching radius and have fresh GPS state. Vehicle requirements are enforced when present. Service-provider category requirements are enforced when present.
