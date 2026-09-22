import { expect, test } from "bun:test";
import { createBetterAuthProvider } from "./index";

test("maps a Better Auth session to a Lunar principal", async () => {
  const provider = createBetterAuthProvider({
    api: { async getSession() { return { user: { id: "user-1" }, session: { id: "session-1" } }; } },
  }, ({ user }) => ({ subjectId: user.id, tenantId: "tenant-1", permissions: ["memory:read"] }));
  await expect(provider.authenticate(new Request("http://localhost/run"))).resolves.toEqual({ subjectId: "user-1", tenantId: "tenant-1", permissions: ["memory:read"] });
});

test("returns no principal when Better Auth has no session", async () => {
  const provider = createBetterAuthProvider({ api: { async getSession() { return null; } } }, () => undefined);
  await expect(provider.authenticate(new Request("http://localhost/run"))).resolves.toBeUndefined();
});
