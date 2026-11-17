export interface JwtPayload {
  sub: string;
  principal_id: string;
  email: string;
  iat?: number;
  exp?: number;
}

export interface AuthenticatedPrincipal {
  principal_id: string;
  email: string;
}

