import { describe, expect, it } from "vitest";

import { hashPassword, needsRehash, verifyPassword } from "./password.js";

describe("hashPassword / verifyPassword", () => {
  it("verifies the correct password against its own hash", async () => {
    const hash = await hashPassword("Amaze@123");
    expect(await verifyPassword("Amaze@123", hash)).toBe(true);
  });

  it("rejects the wrong password", async () => {
    const hash = await hashPassword("Amaze@123");
    expect(await verifyPassword("wrong-password", hash)).toBe(false);
  });

  it("never stores the plaintext password in the hash output", async () => {
    const hash = await hashPassword("Amaze@123");
    expect(hash).not.toContain("Amaze@123");
  });

  it("produces a different hash each time for the same password (random salt)", async () => {
    const first = await hashPassword("Amaze@123");
    const second = await hashPassword("Amaze@123");
    expect(first).not.toBe(second);
    expect(await verifyPassword("Amaze@123", first)).toBe(true);
    expect(await verifyPassword("Amaze@123", second)).toBe(true);
  });

  it("fails closed on a malformed stored hash instead of throwing", async () => {
    await expect(verifyPassword("anything", "not-a-real-hash")).resolves.toBe(false);
    await expect(verifyPassword("anything", "pbkdf2$abc$zz$zz")).resolves.toBe(false);
    await expect(verifyPassword("anything", "")).resolves.toBe(false);
  });

  it("fails closed on a tampered hash portion", async () => {
    const hash = await hashPassword("Amaze@123");
    const parts = hash.split("$");
    const hashPart = parts[3] ?? "";
    parts[3] = hashPart.slice(0, -2) + (hashPart.slice(-2) === "00" ? "ff" : "00");
    expect(await verifyPassword("Amaze@123", parts.join("$"))).toBe(false);
  });

  it("handles an empty password without throwing", async () => {
    const hash = await hashPassword("");
    expect(await verifyPassword("", hash)).toBe(true);
    expect(await verifyPassword("not-empty", hash)).toBe(false);
  });

  it("hashes at 600,000 iterations, and still verifies a hash made at the old 100,000", async () => {
    expect((await hashPassword("Amaze@123")).split("$")[1]).toBe("600000");

    // "Amaze@123" under the count used before ADR-051.
    const salt = new Uint8Array(16).fill(7);
    const key = await crypto.subtle.importKey("raw", new TextEncoder().encode("Amaze@123"), "PBKDF2", false, [
      "deriveBits",
    ]);
    const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", salt, iterations: 100_000, hash: "SHA-256" }, key, 256);
    const hex = (bytes: Uint8Array) => Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
    const old = `pbkdf2$100000$${hex(salt)}$${hex(new Uint8Array(bits))}`;

    expect(await verifyPassword("Amaze@123", old)).toBe(true);
    expect(needsRehash(old)).toBe(true);
  });

  it("asks for a rehash only for a well-formed hash under a lower count", async () => {
    expect(needsRehash(await hashPassword("Amaze@123"))).toBe(false);
    expect(needsRehash("not-a-real-hash")).toBe(false);
    expect(needsRehash("")).toBe(false);
  });
});
