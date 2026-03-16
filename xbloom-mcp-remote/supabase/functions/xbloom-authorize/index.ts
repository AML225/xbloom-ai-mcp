// OAuth 2.0 Authorization endpoint for XBloom MCP
// Auto-approves (single user) and redirects back with auth code
import "jsr:@supabase/functions-js/edge-runtime.d.ts";

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, {
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type",
      },
    });
  }

  const url = new URL(req.url);
  const redirectUri = url.searchParams.get("redirect_uri");
  const state = url.searchParams.get("state");
  const clientId = url.searchParams.get("client_id");

  // Validate client
  if (clientId !== Deno.env.get("OAUTH_CLIENT_ID")) {
    return new Response("Invalid client_id", { status: 403 });
  }

  if (!redirectUri) {
    return new Response("Missing redirect_uri", { status: 400 });
  }

  // Generate auth code
  const arr = new Uint8Array(32);
  crypto.getRandomValues(arr);
  const code = Array.from(arr, b => b.toString(16).padStart(2, "0")).join("");

  // Auto-approve: redirect back with code
  const redirect = new URL(redirectUri);
  redirect.searchParams.set("code", code);
  if (state) redirect.searchParams.set("state", state);

  return Response.redirect(redirect.toString(), 302);
});
