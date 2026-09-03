import { describe, expect, it } from "vitest";
import { createRefreshToken, hashPassword, hashToken, verifyPassword } from "./service";

describe("auth security primitives", () => {
  it("hashes and verifies passwords", async () => {
    const password = "correct horse battery staple";
    const hash = await hashPassword(password);

    expect(hash).not.toContain(password);
    await expect(verifyPassword(password, hash)).resolves.toBe(true);
    await expect(verifyPassword("wrong password", hash)).resolves.toBe(false);
  });

  it("creates high-entropy refresh tokens and stable hashes", () => {
    const first = createRefreshToken();
    const second = createRefreshToken();

    expect(first).not.toEqual(second);
    expect(first.length).toBeGreaterThan(40);
    expect(hashToken(first)).toEqual(hashToken(first));
    expect(hashToken(first)).not.toEqual(hashToken(second));
  });
});
