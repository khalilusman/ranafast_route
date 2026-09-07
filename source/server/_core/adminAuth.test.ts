import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import type { Request, Response } from "express";
import { COOKIE_NAME } from "@shared/const";
import { handleAdminLogin } from "./adminAuth";
import { ENV } from "./env";
import { sdk } from "./sdk";

function makeReq(body: unknown): Request {
  return { body, protocol: "https", headers: {} } as unknown as Request;
}

function makeRes() {
  const res = {} as Response & {
    statusCode?: number;
    cookieCalls: Array<{ name: string; value: string; options: Record<string, unknown> }>;
  };
  res.cookieCalls = [];
  res.status = vi.fn((code: number) => {
    res.statusCode = code;
    return res;
  }) as unknown as Response["status"];
  res.json = vi.fn().mockReturnValue(res) as unknown as Response["json"];
  res.cookie = vi.fn((name: string, value: string, options: Record<string, unknown>) => {
    res.cookieCalls.push({ name, value, options });
    return res;
  }) as unknown as Response["cookie"];
  return res;
}

describe("POST /api/admin/login", () => {
  const originalPasscode = ENV.adminPasscode;
  const originalSecret = ENV.cookieSecret;

  beforeEach(() => {
    ENV.adminPasscode = "correct-horse-battery-staple";
    ENV.cookieSecret = "test-jwt-secret";
  });

  afterEach(() => {
    ENV.adminPasscode = originalPasscode;
    ENV.cookieSecret = originalSecret;
  });

  it("rejects a missing passcode", async () => {
    const res = makeRes();
    await handleAdminLogin(makeReq({}), res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.cookieCalls).toHaveLength(0);
  });

  it("rejects an incorrect passcode", async () => {
    const res = makeRes();
    await handleAdminLogin(makeReq({ passcode: "wrong" }), res);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.cookieCalls).toHaveLength(0);
  });

  it("returns 500 when ADMIN_PASSCODE is not configured", async () => {
    ENV.adminPasscode = "";
    const res = makeRes();
    await handleAdminLogin(makeReq({ passcode: "anything" }), res);

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.cookieCalls).toHaveLength(0);
  });

  it("issues a signed admin session cookie for the correct passcode", async () => {
    const res = makeRes();
    await handleAdminLogin(
      makeReq({ passcode: "correct-horse-battery-staple" }),
      res
    );

    expect(res.json).toHaveBeenCalledWith({ success: true });
    expect(res.cookieCalls).toHaveLength(1);

    const cookie = res.cookieCalls[0]!;
    expect(cookie.name).toBe(COOKIE_NAME);
    expect(cookie.options).toMatchObject({ httpOnly: true, path: "/" });

    const session = await sdk.verifySession(cookie.value);
    expect(session).toEqual({ role: "admin" });
  });
});
