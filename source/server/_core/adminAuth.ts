import { COOKIE_NAME, ONE_YEAR_MS } from "@shared/const";
import { timingSafeEqual } from "crypto";
import type { Express, Request, Response } from "express";
import { getSessionCookieOptions } from "./cookies";
import { ENV } from "./env";
import { sdk } from "./sdk";

function passcodesMatch(candidate: string, expected: string): boolean {
  const candidateBuf = Buffer.from(candidate);
  const expectedBuf = Buffer.from(expected);

  if (candidateBuf.length !== expectedBuf.length) {
    return false;
  }

  return timingSafeEqual(candidateBuf, expectedBuf);
}

export async function handleAdminLogin(req: Request, res: Response) {
  const passcode =
    typeof req.body?.passcode === "string" ? req.body.passcode : "";

  if (!passcode) {
    res.status(400).json({ error: "Passcode is required" });
    return;
  }

  if (!ENV.adminPasscode) {
    console.error("[Admin] ADMIN_PASSCODE is not configured");
    res.status(500).json({ error: "Admin login is not configured" });
    return;
  }

  if (!passcodesMatch(passcode, ENV.adminPasscode)) {
    res.status(401).json({ error: "Invalid passcode" });
    return;
  }

  const sessionToken = await sdk.createAdminSessionToken({
    expiresInMs: ONE_YEAR_MS,
  });

  const cookieOptions = getSessionCookieOptions(req);
  res.cookie(COOKIE_NAME, sessionToken, { ...cookieOptions, maxAge: ONE_YEAR_MS });

  res.json({ success: true });
}

export function registerAdminAuthRoutes(app: Express) {
  app.post("/api/admin/login", handleAdminLogin);
}
