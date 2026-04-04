// Minimal stateless OAuth 2.0 layer
// Single-user: auto-approves all authorization requests
// No database or session storage needed — credentials are handled via env vars

const BASE_URL = Deno.env.get("MCP_BASE_URL") || "http://localhost:8000";
const OAUTH_CLIENT_ID = "xbloom-mcp-client";
const OAUTH_CLIENT_SECRET = "xbloom-mcp-secret";

function generateToken(): string {
  const arr = new Uint8Array(32);
  crypto.getRandomValues(arr);
  return Array.from(arr, b => b.toString(16).padStart(2, "0")).join("");
}

export function oauthDiscoveryResource() {
  return {
    resource: BASE_URL,
    authorization_servers: [BASE_URL],
    bearer_methods_supported: ["header"],
  };
}

export function oauthDiscoveryServer() {
  return {
    issuer: BASE_URL,
    authorization_endpoint: `${BASE_URL}/authorize`,
    token_endpoint: `${BASE_URL}/token`,
    registration_endpoint: `${BASE_URL}/register`,
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    token_endpoint_auth_methods_supported: ["client_secret_post", "client_secret_basic"],
    code_challenge_methods_supported: ["S256", "plain"],
  };
}

export function handleAuthorize(url: URL): Response {
  const redirectUri = url.searchParams.get("redirect_uri");
  const state = url.searchParams.get("state");
  const clientId = url.searchParams.get("client_id");

  if (!redirectUri) return new Response("Missing redirect_uri", { status: 400 });
  if (clientId && clientId !== OAUTH_CLIENT_ID) {
    return new Response("Invalid client_id", { status: 403 });
  }

  const code = generateToken();
  const redirect = new URL(redirectUri);
  redirect.searchParams.set("code", code);
  if (state) redirect.searchParams.set("state", state);
  return Response.redirect(redirect.toString(), 302);
}

export async function handleToken(req: Request): Promise<Response> {
  const contentType = req.headers.get("content-type") || "";
  let params: URLSearchParams;
  if (contentType.includes("application/json")) {
    params = new URLSearchParams(await req.json() as Record<string, string>);
  } else {
    params = new URLSearchParams(await req.text());
  }

  const grantType = params.get("grant_type");
  const mcpToken = Deno.env.get("MCP_AUTH_TOKEN") || "";

  if (grantType === "authorization_code" || grantType === "refresh_token") {
    return new Response(JSON.stringify({
      access_token: mcpToken,
      token_type: "Bearer",
      expires_in: 31536000,
      refresh_token: mcpToken,
    }), {
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, Authorization",
      },
    });
  }

  return new Response(JSON.stringify({ error: "unsupported_grant_type" }), {
    status: 400,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
    },
  });
}

export function handleRegister(body: Record<string, unknown>): Response {
  return new Response(JSON.stringify({
    client_id: OAUTH_CLIENT_ID,
    client_secret: OAUTH_CLIENT_SECRET,
    client_name: body.client_name || "Claude",
    client_id_issued_at: Math.floor(Date.now() / 1000),
    client_secret_expires_at: 0,
    redirect_uris: body.redirect_uris || [],
    grant_types: ["authorization_code", "refresh_token"],
    response_types: ["code"],
    token_endpoint_auth_method: "client_secret_post",
  }), {
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
    },
  });
}