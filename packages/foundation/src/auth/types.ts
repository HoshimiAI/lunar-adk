export interface AuthPrincipal {
  subjectId: string;
  tenantId: string;
  workspaceId?: string;
  permissions: readonly string[];
}

export interface AuthProvider {
  authenticate(request: Request): Promise<AuthPrincipal | undefined>;
}
