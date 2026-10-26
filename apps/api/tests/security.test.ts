import { afterAll, it, expect, vi } from "vitest";
import express from "express";
import request from "supertest";
import { randomUUID } from "node:crypto";
import { api, registerUser } from "./helpers";
import { prisma } from "../src/core/prisma";
import { issueOtp, verifyOtp } from "../src/modules/auth/otp.service";
import { makeLimiter } from "../src/middleware/rate-limit";
const ids: string[] = [];
async function user() {
  const u = await registerUser();
  ids.push(u.id);
  return u;
}
afterAll(async () => {
  await prisma.user.deleteMany({ where: { id: { in: ids } } });
});
it("revokes access immediately on logout", async () => {
  const u = await user();
  await api()
    .post("/api/v1/auth/logout")
    .send({ refreshToken: u.refreshToken })
    .expect(204);
  await api()
    .get("/api/v1/auth/me")
    .set("Authorization", "Bearer " + u.accessToken)
    .expect(401);
});
it("revokes all access sessions after changing a password", async () => {
  const u = await user();
  await api()
    .post("/api/v1/auth/change-password")
    .set("Authorization", "Bearer " + u.accessToken)
    .send({ currentPassword: u.password, newPassword: "ChangedSecure123!" })
    .expect(204);
  await api()
    .get("/api/v1/auth/me")
    .set("Authorization", "Bearer " + u.accessToken)
    .expect(401);
  await api()
    .post("/api/v1/auth/refresh")
    .send({ refreshToken: u.refreshToken })
    .expect(401);
});
it("revokes access after a password reset", async () => {
  const u = await user();
  const { code } = await issueOtp(u.email, "PASSWORD_RESET", u.id);
  await api()
    .post("/api/v1/auth/password-reset/confirm")
    .send({ identifier: u.email, code, newPassword: "ChangedSecure123!" })
    .expect(204);
  await api()
    .get("/api/v1/auth/me")
    .set("Authorization", "Bearer " + u.accessToken)
    .expect(401);
});
it("serializes concurrent refresh attempts and commits replay revocation", async () => {
  const u = await user();
  const results = await Promise.all(
    [1, 2].map(() =>
      api().post("/api/v1/auth/refresh").send({ refreshToken: u.refreshToken }),
    ),
  );
  expect(results.map((r) => r.status).sort()).toEqual([200, 401]);
  expect(
    await prisma.refreshToken.count({
      where: { userId: u.id, revokedAt: null },
    }),
  ).toBe(0);
  const token = results.find((r) => r.status === 200)!.body.data.tokens
    .accessToken;
  await api()
    .get("/api/v1/auth/me")
    .set("Authorization", "Bearer " + token)
    .expect(401);
});
it("consumes an account OTP only once under concurrent requests", async () => {
  const u = await user();
  const { code } = await issueOtp(u.email, "PASSWORD_RESET", u.id);
  const results = await Promise.allSettled(
    [1, 2, 3].map(() => verifyOtp(u.email, "PASSWORD_RESET", code)),
  );
  expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
});
it("keeps parallel OTP guesses within the attempt ceiling and binds hashes to identity", async () => {
  const u = await user();
  const { code } = await issueOtp(u.email, "PASSWORD_RESET", u.id);
  const wrong = code === "000000" ? "111111" : "000000";
  await Promise.allSettled(
    Array.from({ length: 10 }, () =>
      verifyOtp(u.email, "PASSWORD_RESET", wrong),
    ),
  );
  const stored = await prisma.otpVerification.findFirstOrThrow({
    where: { userId: u.id, purpose: "PASSWORD_RESET" },
    orderBy: { createdAt: "desc" },
  });
  expect(stored.attempts).toBe(5);
  expect(stored.consumedAt).not.toBeNull();
  await expect(verifyOtp(u.email, "PASSWORD_RESET", code)).rejects.toThrow();
  const { createHash } = await import("node:crypto");
  expect(stored.codeHash).not.toBe(
    createHash("sha256").update(code).digest("hex"),
  );
});
it("requires trusted origins for cookie writes while permitting bearer clients", async () => {
  const u = await user();
  const cookie = "lunch_access_token=" + u.accessToken;
  await api()
    .patch("/api/v1/profile/me")
    .set("Cookie", cookie)
    .send({ fullName: "CSRF change" })
    .expect(403);
  await api()
    .patch("/api/v1/profile/me")
    .set("Cookie", cookie)
    .set("Origin", "https://evil.test")
    .send({ fullName: "CSRF change" })
    .expect(403);
  await api()
    .patch("/api/v1/profile/me")
    .set("Cookie", cookie)
    .set("Origin", "http://localhost:3000")
    .send({ fullName: "Allowed change" })
    .expect(200);
  await api()
    .patch("/api/v1/profile/me")
    .set("Authorization", "Bearer " + u.accessToken)
    .send({ fullName: "Native client" })
    .expect(200);
  const r = await api()
    .get("/api/v1/profile/me")
    .set("Cookie", cookie)
    .expect(200);
  expect(r.headers["cache-control"]).toContain("no-store");
});
it("rejects forged and unsigned tokens and responds to live role/status changes", async () => {
  const u = await user();
  const jwt = await import("jsonwebtoken");
  const unsigned = jwt.default.sign({ sub: u.id, role: "SUPER_ADMIN" }, "", {
    algorithm: "none",
  });
  await api()
    .get("/api/v1/admin/users")
    .set("Authorization", "Bearer " + unsigned)
    .expect(401);
  await api()
    .get("/api/v1/admin/users")
    .set("Authorization", "Bearer " + u.accessToken)
    .expect(403);
  await prisma.user.update({
    where: { id: u.id },
    data: { status: "SUSPENDED" },
  });
  await api()
    .get("/api/v1/profile/me")
    .set("Authorization", "Bearer " + u.accessToken)
    .expect(403);
});
it("rejects operator injection, oversized input, binary uploads and unsafe URL schemes", async () => {
  const u = await user();
  const auth = { Authorization: "Bearer " + u.accessToken };
  await api()
    .post("/api/v1/auth/login")
    .send({ identifier: { $ne: null }, password: { $gt: "" } })
    .expect(422);
  await api()
    .get("/api/v1/children/" + encodeURIComponent("' OR 1=1 --"))
    .set(auth)
    .expect(404);
  await api()
    .patch("/api/v1/profile/me")
    .set(auth)
    .send({ avatarUrl: "javascript:alert(1)" })
    .expect(422);
  await api()
    .patch("/api/v1/profile/me")
    .set(auth)
    .send({ foodPreferences: Array(1001).fill("a") })
    .expect(400);
  await api()
    .post("/api/v1/auth/login")
    .send({ identifier: "x".repeat(1100000), password: "a" })
    .expect(413);
  await api()
    .patch("/api/v1/profile/me")
    .set(auth)
    .attach("avatar", Buffer.from('<svg onload="alert(1)"/>'), "avatar.svg")
    .expect(415);
});
it("does not truncate new passwords at the bcrypt byte limit", async () => {
  await api()
    .post("/api/v1/auth/register")
    .send({
      fullName: "Too long",
      email: randomUUID() + "@test.lunch",
      password: "Ab1" + "é".repeat(36),
    })
    .expect(422);
});
it("rate limits even when a caller spoofs forwarding headers", async () => {
  const app = express();
  app.set("trust proxy", false);
  app.use(makeLimiter({ limit: 2, windowMs: 60000, skip: () => false }));
  app.get("/", (_req, res) => res.sendStatus(200));
  for (let i = 0; i < 2; i++)
    await request(app)
      .get("/")
      .set("X-Forwarded-For", "192.0.2." + i)
      .expect(200);
  await request(app).get("/").set("X-Forwarded-For", "192.0.2.99").expect(429);
});
it("returns secure browser cookie attributes and no stored password material", async () => {
  const u = await user();
  const r = await api()
    .post("/api/v1/auth/login")
    .send({ identifier: u.email, password: u.password })
    .expect(200);
  for (const cookie of r.headers["set-cookie"]) {
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("SameSite=Lax");
  }
  expect(JSON.stringify(r.body)).not.toMatch(/passwordHash|codeHash|tokenHash/);
  const stored = await prisma.user.findUniqueOrThrow({ where: { id: u.id } });
  expect(stored.passwordHash).not.toBe(u.password);
  expect(stored.passwordHash).toMatch(/^\$2/);
});

it("does not mark provider verification successful after a network failure", async () => {
  const u = await user();
  const order = await prisma.order.create({
    data: {
      customerId: u.id,
      orderNumber: "SEC-" + randomUUID(),
      subtotal: 100,
      totalAmount: 100,
    },
  });
  const p = await prisma.payment.create({
    data: {
      orderId: order.id,
      amount: 100,
      status: "PENDING",
      provider: "MOCK",
      providerOrderId: "missing_" + randomUUID(),
      initializationStartedAt: new Date(),
    },
  });
  const lookup = vi
    .spyOn(prisma.payment, "findMany")
    .mockResolvedValueOnce([{ ...p, order: { customerId: u.id } }] as never);
  try {
    const { reconcilePayments } =
      await import("../src/modules/payments/payment.service");
    await reconcilePayments();
    expect(
      (await prisma.payment.findUniqueOrThrow({ where: { id: p.id } }))
        .lastVerifiedAt,
    ).toBeNull();
  } finally {
    lookup.mockRestore();
    await prisma.order.delete({ where: { id: order.id } });
  }
});
