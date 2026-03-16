// OAuth 2.0 Token endpoint for XBloom MCP
// Exchanges auth code for access token (returns the MCP bearer token)
import "jsr:@supabase/functions-js/edge-runtime.d.ts";

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, {
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, Authorization",
      },
    });
  }

  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  // Parse body (supports both form-encoded and JSON)
  const contentType = req.headers.get("content-type") || "";
  let params: URLSearchParams;

  if (contentType.includes("application/json")) {
    const body = await req.json();
    params = new URLSearchParams(body as Record<string, string>);
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
      headers: { "Content-Type": "application/json" },
    });
  }

  return new Response(JSON.stringify({ error: "unsupported_grant_type" }), {
    status: 400,
    headers: { "Content-Type": "application/json" },
  });
});
