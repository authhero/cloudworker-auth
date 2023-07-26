import { Context, Next } from "cloudworker-router";
import { UnauthorizedError } from "./errors";
import { getDb } from "./services/db";
import { Env } from "./types/Env";

interface TokenData {
  header: {
    alg: string;
    typ: string;
    kid: string;
  };
  payload: {
    sub: string;
    iss: string;
    aud: string[];
    iat: number;
    exp: number;
    scope: string;
    permissions?: string[];
    azp?: string;
  };
  signature: string;
  raw: {
    header: string;
    payload: string;
    signature: string;
  };
}

interface JwkKey {
  alg: "RS256";
  kty: "RSA";
  use: "sig";
  n: string;
  e: string;
  kid: string;
  x5t: string;
  x5c: string[];
}

/**
 * Parse and decode a JWT.
 * A JWT is three, base64 encoded, strings concatenated with ‘.’:
 *   a header, a payload, and the signature.
 * The signature is “URL safe”, in that ‘/+’ characters have been replaced by ‘_-’
 *
 * Steps:
 * 1. Split the token at the ‘.’ character
 * 2. Base64 decode the individual parts
 * 3. Retain the raw Bas64 encoded strings to verify the signature
 */
function decodeJwt(token: string): TokenData {
  const parts = token.split(".");
  const header = JSON.parse(atob(parts[0]));
  const payload = JSON.parse(atob(parts[1]));
  const signature = atob(parts[2].replace(/-/g, "+").replace(/_/g, "/"));

  return {
    header,
    payload,
    signature,
    raw: { header: parts[0], payload: parts[1], signature: parts[2] },
  };
}

async function getJwks(env: Env) {
  // TODO: add caching

  // If we're using this service for authenticating
  if (env.JWKS_URL.startsWith(env.ISSUER)) {
    const certificatesString = await env.CERTIFICATES.get("default");
    const keys = (certificatesString ? JSON.parse(certificatesString) : []).map(
      (cert: any) => {
        return { kid: cert.kid, ...cert.publicKey };
      },
    );

    return keys;
  }

  const response = env.TOKEN_SERVICE
    ? await env.TOKEN_SERVICE.fetch(env.JWKS_URL)
    : await fetch(env.JWKS_URL);

  if (!response.ok) {
    throw new Error("Failed to fetch jwks");
  }

  const body = await response.json();

  return (body as any).keys as JwkKey[];
}

function isValidScopes(token: TokenData, scopes: string[]) {
  const tokenScopes = token.payload.scope?.split(" ") || [];

  const match = !scopes.some((scope) => !tokenScopes.includes(scope));

  return match;
}

async function isValidJwtSignature(ctx: Context<Env>, token: TokenData) {
  const encoder = new TextEncoder();
  const data = encoder.encode([token.raw.header, token.raw.payload].join("."));
  const signature = new Uint8Array(
    Array.from(token.signature).map((c) => c.charCodeAt(0)),
  );

  const jwkKeys = await getJwks(ctx.env);

  const jwkKey = jwkKeys.find((key) => key.kid === token.header.kid);

  if (!jwkKey) {
    console.log("No matching kid found");
    return false;
  }

  const key = await crypto.subtle.importKey(
    "jwk",
    jwkKey,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["verify"],
  );

  return crypto.subtle.verify("RSASSA-PKCS1-v1_5", key, signature, data);
}

export async function getUser(
  ctx: Context<Env>,
  bearer: string,
  scopes: string[],
): Promise<any | null> {
  const token = decodeJwt(bearer);

  // Is the token expired?
  const expiryDate = new Date(token.payload.exp * 1000);
  const currentDate = new Date(Date.now());
  if (expiryDate < currentDate) {
    return null;
  }

  if (!isValidScopes(token, scopes)) {
    return null;
  }

  if (!(await isValidJwtSignature(ctx, token))) {
    return null;
  }

  return token.payload;
}

export async function verifyTenantPermissions(ctx: Context<Env>) {
  const tenantId = ctx.params.tenantId;
  if (!tenantId) {
    return;
  }

  if (
    !["POST", "PATCH", "PUT", "DELETE", "GET", "HEAD"].includes(
      ctx.request.method,
    )
  ) {
    // Don't bother about OPTIONS requests
    return;
  }

  // Check token permissions first
  const permissions: string[] = ctx.state.user.permissions || [];

  if (["GET", "HEAD"].includes(ctx.request.method)) {
    // Read requets
    if (permissions.includes(ctx.env.READ_PERMISSION as string)) {
      return;
    }
  } else {
    // Write requests
    if (permissions.includes(ctx.env.WRITE_PERMISSION as string)) {
      return;
    }
  }

  // Check db permissions
  const db = getDb(ctx.env);
  const member = await db
    .selectFrom("members")
    .where("members.sub", "=", ctx.state.user.sub)
    .where("members.tenantId", "=", tenantId)
    .where("members.status", "=", "active")
    .select("members.role")
    .executeTakeFirst();

  if (!member?.role) {
    throw new UnauthorizedError();
  }

  if (["GET", "HEAD"].includes(ctx.request.method)) {
    // Read requets
    if (["admin", "viewer"].includes(member.role)) {
      return;
    }
  } else {
    // Write requests
    if (["admin"].includes(member.role)) {
      return;
    }
  }

  throw new UnauthorizedError();
}

export interface Security {
  oauth2: string[];
}

export function authenticationHandler(security: Security[]) {
  const [scope] = security[0].oauth2;
  return async function jwtMiddleware(
    ctx: Context<Env>,
    next: Next,
  ): Promise<Response | undefined> {
    const authHeader = ctx.headers.get("authorization");
    if (!authHeader || !authHeader.toLowerCase().startsWith("bearer")) {
      return new Response("Forbidden", {
        status: 403,
      });
    }
    const bearer = authHeader.slice(7);
    ctx.state.user = await getUser(ctx, bearer, scope?.split(" ") || []);

    await verifyTenantPermissions(ctx);

    if (!ctx.state.user) {
      return new Response("Not Authorized", {
        status: 403,
        headers: {
          "content-type": "text/plain",
        },
      });
    }

    return next();
  };
}
