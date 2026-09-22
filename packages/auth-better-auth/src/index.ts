import type { AuthPrincipal, AuthProvider } from "@lunar/foundation/auth";

export interface BetterAuthSession<User = unknown, Session = unknown> {
  user: User;
  session: Session;
}

export interface BetterAuthLike<User = unknown, Session = unknown> {
  api: { getSession(options: { headers: Headers }): Promise<BetterAuthSession<User, Session> | null> };
}

export function createBetterAuthProvider<User = unknown, Session = unknown>(
  auth: BetterAuthLike<User, Session>,
  mapPrincipal: (session: BetterAuthSession<User, Session>) => AuthPrincipal | undefined | Promise<AuthPrincipal | undefined>,
): AuthProvider {
  return {
    async authenticate(request) {
      const session = await auth.api.getSession({ headers: request.headers });
      return session ? await mapPrincipal(session) : undefined;
    },
  };
}
