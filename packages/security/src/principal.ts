export type AuthenticationMethod = "oauth";

export type SecurityPrincipal = {
  subject: string;
  clientId: string;
  authenticationMethod: AuthenticationMethod;
  scopes: ReadonlySet<string>;
  authenticatedAt: Date;
};

export type SecurityContext = {
  principal: SecurityPrincipal;
  sessionId: string;
  requestId: string;
};

