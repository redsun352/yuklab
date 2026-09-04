# Critical API integration flow

The CI pipeline provisions PostgreSQL/PostGIS and Redis, prepares the Prisma schema, then runs the API test suite.

`apps/api/src/e2e-critical-flow.test.ts` exercises the critical customer/provider lifecycle:

1. Register and authenticate customer and provider.
2. Activate the provider role/profile in the test database.
3. Create a published order with coordinates and TRY budget.
4. Submit and list a provider offer.
5. Customer accepts the offer and the provider is assigned.
6. Provider advances the order through pickup and transit states.
7. Provider submits GPS and the customer reads live tracking.
8. Provider completes delivery.
9. Customer tracking is rejected after the order reaches the terminal `COMPLETED` state.

The test uses unique email addresses per run and removes its database records during teardown.
