// XBloom MCP Server
// Self-hosted MCP server for Claude desktop/web/mobile
// Single-user: credentials are read from XBLOOM_EMAIL and XBLOOM_PASSWORD environment variables

import { Buffer } from "node:buffer";
import { publicEncrypt, constants } from "node:crypto";
import { handleAuthorize, handleToken, handleRegister, oauthDiscoveryResource, oauthDiscoveryServer } from "./oauth.ts";

// --- XBloom API constants ---

const API_BASE = "https://client-api.xbloom.com";
const SHARE_BASE = "https://share-h5.xbloom.com";

const RSA_PUBLIC_KEY_B64 =
  "MIGfMA0GCSqGSIb3DQEBAQUAA4GNADCBiQKBgQC4LF40GZ72SdhMyl765K/i4nY5" +
  "CPcHz2Q1IKWKZ9S79xmK7G8pUhbVf4EZLvnNF1+9IvOFQUKV5Z7ZNNviqSpnql9" +
  "tAT+8+J/He0R7pcirvVSxgdr2i9V/C/gmqAEZ5qVTzRnd3uWdFoKzPdEBxP0Ipor" +
  "J1VBbCv90yBSOhVxO+QIDAQAB";

const pemBody = RSA_PUBLIC_KEY_B64.match(/.{1,64}/g)!.join("\n");
const RSA_PUBLIC_KEY_PEM = `-----BEGIN PUBLIC KEY-----\n${pemBody}\n-----END PUBLIC KEY-----`;

const API_HEADERS: Record<string, string> = {
  "Content-Type": "application/json",
  "Referer": `${SHARE_BASE}/`,
  "User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)",
};

// --- Resource files ---
let brewingReference = "";
let customInstructions = "";
let userPreferences = "";

try {
  brewingReference = await Deno.readTextFile("./resources/xbloom-brewing-reference.md");
  customInstructions = await Deno.readTextFile("./resources/custom-instructions.md");
  console.log("Resource files loaded successfully");
} catch (e) {
  console.error(`Failed to load resource files: ${String(e)}`);
}

// --- User preferences ---
// Persistent file stored on Docker volume, survives container updates.
// If not found, copy template from image as starting point.

try {
  await Deno.stat("/app/data/user-preferences.md");
} catch {
  try {
    const template = await Deno.readTextFile("./resources/user-preferences-template.md");
    await Deno.mkdir("/app/data", { recursive: true });
    await Deno.writeTextFile("/app/data/user-preferences.md", template);
    console.log("Created user preferences file from template");
  } catch (e) {
    console.error(`Failed to create user preferences file: ${String(e)}`);
  }
}

try {
  userPreferences = await Deno.readTextFile("/app/data/user-preferences.md");
  console.log("User preferences loaded successfully");
} catch (e) {
  console.error(`Failed to load user preferences: ${String(e)}`);
}

// --- Environment variables ---

const XBLOOM_EMAIL = Deno.env.get("XBLOOM_EMAIL") || "";
const XBLOOM_PASSWORD = Deno.env.get("XBLOOM_PASSWORD") || "";
const MCP_AUTH_TOKEN = Deno.env.get("MCP_AUTH_TOKEN") || "";

let cachedCredentials: UserCredentials | null = null;

interface UserCredentials {
  memberId: number;
  token: string;
  email: string;
}

// --- XBloom authentication ---
// Logs in once at startup using environment variables and caches credentials in memory.
// Set XBLOOM_EMAIL and XBLOOM_PASSWORD in your .env file.

async function initCredentials(): Promise<void> {
  if (cachedCredentials) return;
  if (!XBLOOM_EMAIL || !XBLOOM_PASSWORD) {
    console.error("XBLOOM_EMAIL and XBLOOM_PASSWORD environment variables are required");
    return;
  }
  const resp = await postPlain("tMemberLogin.thtml", {
    interfaceVersion: 20240918,
    skey: "testskey",
    clientType: 2,
    phoneType: "Android",
    languageType: 1,
    email: XBLOOM_EMAIL,
    password: XBLOOM_PASSWORD,
  });
  if (resp.result === "success") {
    const member = resp.member as Record<string, unknown>;
    cachedCredentials = {
      memberId: member.tableId as number,
      token: resp.token as string,
      email: XBLOOM_EMAIL,
    };
    console.log("XBloom login successful");
  } else {
    console.error("XBloom login failed — check XBLOOM_EMAIL and XBLOOM_PASSWORD");
  }
}

// --- RSA Encryption (hutool-style chunking) ---

function rsaEncrypt(payload: Record<string, unknown>): string {
  const plaintext = Buffer.from(JSON.stringify(payload), "utf-8");
  const chunkSize = 117;
  const chunks: Buffer[] = [];
  for (let i = 0; i < plaintext.length; i += chunkSize) {
    const chunk = plaintext.subarray(i, i + chunkSize);
    const encrypted = publicEncrypt(
      { key: RSA_PUBLIC_KEY_PEM, padding: constants.RSA_PKCS1_PADDING },
      chunk,
    );
    chunks.push(encrypted);
  }
  return Buffer.concat(chunks).toString("base64");
}

// --- HTTP helpers ---

async function postPlain(
  endpoint: string,
  payload: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  try {
    const resp = await fetch(`${API_BASE}/${endpoint}`, {
      method: "POST",
      headers: API_HEADERS,
      body: JSON.stringify(payload),
    });
    return await resp.json();
  } catch (e) {
    return { result: "error", error: String(e) };
  }
}

async function postEncrypted(
  endpoint: string,
  payload: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  try {
    const encrypted = rsaEncrypt(payload);
    const resp = await fetch(`${API_BASE}/${endpoint}`, {
      method: "POST",
      headers: { ...API_HEADERS, "Content-Type": "application/json" },
      body: JSON.stringify(encrypted),
    });
    return await resp.json();
  } catch (e) {
    return { result: "error", error: String(e) };
  }
}

// --- Auth ---

function authBase(creds: UserCredentials): Record<string, unknown> {
  return {
    interfaceVersion: 20240918,
    skey: "testskey",
    phoneType: "Android",
    memberId: creds.memberId,
    clientType: 2,
    languageType: 1,
    token: creds.token,
  };
}

// --- Tool definitions ---

const TOOLS = [
  {
    name: "xbloom_list_recipes",
    description: "List all recipes on your XBloom account. Returns recipe IDs needed for edit/delete.",
    inputSchema: { type: "object" as const, properties: {}, required: [] as string[] },
  },
  {
    name: "xbloom_create_recipe",
    description: "Push a new coffee recipe to your XBloom account. Appears in the xBloom iOS app. For tea, use xbloom_create_tea_recipe instead.",
    inputSchema: {
      type: "object" as const,
      properties: {
        name: { type: "string", description: "Recipe name" },
        dose_g: { type: "number", description: "Coffee dose in grams (5-31, recommend max ~18g)" },
        ratio: { type: "number", description: "Water ratio (total = dose_g * ratio)" },
        grind_size: { type: "number", description: "Grind size 1-80 (lower = finer, recommend 30-80 for xBloom Studio)" },
        grind_rpm: { type: "number", description: "Grinder RPM 60-120" },
        pours: {
          type: "array",
          description: "Pour steps",
          items: {
            type: "object",
            properties: {
              volume_ml: { type: "number" },
              temperature_c: { type: "number", description: "Temperature in °C: 20 (RT/room temp), 40-95 (integer steps), 99 (BP/boiling)" },
              pattern: { type: "string", enum: ["centered", "circular", "spiral"] },
              flow_rate: { type: "number" },
              pause_seconds: { type: "integer" },
              agitate_before: { type: "boolean" },
              agitate_after: { type: "boolean" },
            },
          },
        },
        color: { type: "string", description: "Hex color (default: #C9D5B8)" },
      },
      required: ["name", "dose_g", "ratio", "grind_size", "grind_rpm", "pours"],
    },
  },
  {
    name: "xbloom_create_tea_recipe",
    description: "Push a new tea recipe to your XBloom account for the Omni Tea Brewer. Uses tea-specific settings (no grinding, longer steep times, lower doses). Max 3 steeps, max 90ml per steep, max 10g dose, steep up to 360 seconds.",
    inputSchema: {
      type: "object" as const,
      properties: {
        name: { type: "string", description: "Tea recipe name" },
        dose_g: { type: "number", description: "Tea dose in grams (1-10)" },
        ratio: { type: "number", description: "Water ratio (total = dose_g * ratio)" },
        steeps: {
          type: "array",
          description: "Steep steps (max 3)",
          items: {
            type: "object",
            properties: {
              volume_ml: { type: "number", description: "Water volume per steep (max 90ml)" },
              temperature_c: { type: "number", description: "Water temperature. Green: 70-80, White: 75-85, Oolong: 85-95, Black: 90-100, Herbal: 100" },
              steep_seconds: { type: "integer", description: "Steep time in seconds (0-360)" },
              flow_rate: { type: "number", description: "Water flow rate (default 3.0)" },
            },
          },
        },
        color: { type: "string", description: "Hex color (default: #A8C686)" },
      },
      required: ["name", "dose_g", "ratio", "steeps"],
    },
  },
  {
    name: "xbloom_edit_recipe",
    description: "Edit an existing recipe by recipe_id. Only pass fields to change. If updating pours, pass the full list.",
    inputSchema: {
      type: "object" as const,
      properties: {
        recipe_id: { type: "integer", description: "Recipe ID from list" },
        name: { type: "string" },
        dose_g: { type: "number" },
        ratio: { type: "number" },
        grind_size: { type: "number" },
        grind_rpm: { type: "number" },
        pours: {
          type: "array",
          items: {
            type: "object",
            properties: {
              volume_ml: { type: "number" },
              temperature_c: { type: "number", description: "Temperature in °C: 20 (RT/room temp), 40-95 (integer steps), 99 (BP/boiling)" },
              pattern: { type: "string", enum: ["centered", "circular", "spiral"] },
              flow_rate: { type: "number" },
              pause_seconds: { type: "integer" },
              agitate_before: { type: "boolean" },
              agitate_after: { type: "boolean" },
            },
          },
        },
        color: { type: "string" },
      },
      required: ["recipe_id"],
    },
  },
  {
    name: "xbloom_delete_recipe",
    description: "Delete a recipe. Cannot be undone.",
    inputSchema: {
      type: "object" as const,
      properties: {
        recipe_id: { type: "integer", description: "Recipe ID from list" },
      },
      required: ["recipe_id"],
    },
  },
  {
    name: "xbloom_fetch_recipe",
    description: "Fetch a recipe from a share URL or ID. Does not require login.",
    inputSchema: {
      type: "object" as const,
      properties: {
        share_url: { type: "string", description: "Share URL or encoded ID" },
      },
      required: ["share_url"],
    },
  },
  {
    name: "xbloom_read_resource",
    description: "Read a server resource file. Always call this before updating preferences to avoid data loss. Also useful for referencing brewing science or custom instructions on demand.",
    inputSchema: {
      type: "object" as const,
      properties: {
        resource: {
          type: "string",
          enum: ["user-preferences", "brewing-reference", "custom-instructions"],
          description: "Which resource to read",
        },
      },
      required: ["resource"],
    },
  },
  {
    name: "xbloom_update_preferences",
    description: "Update the persistent user preferences file with new information about beans, preferences, tasting notes, or observations. Read the current content first, then write the full updated content back.",
    inputSchema: {
      type: "object" as const,
      properties: {
        content: { type: "string", description: "Full markdown content to write to the preferences file" },
      },
      required: ["content"],
    },
  },
];

// --- Tool implementations ---

const PATTERN_MAP: Record<string, number> = { centered: 1, spiral: 2, circular: 3 };
const PATTERN_REV: Record<number, string> = { 1: "centered", 2: "spiral", 3: "circular" };

interface Pour {
  volume_ml?: number;
  temperature_c?: number;
  pattern?: string;
  flow_rate?: number;
  pause_seconds?: number;
  agitate_before?: boolean;
  agitate_after?: boolean;
}

function buildPourList(pours: Pour[]) {
  return pours.map((p, i) => ({
    theName: i === 0 ? "Bloom" : `Pour ${i + 1}`,
    volume: Number(p.volume_ml ?? 30),
    temperature: Number(p.temperature_c ?? 93),
    flowRate: Number(p.flow_rate ?? 3.0),
    pattern: PATTERN_MAP[p.pattern ?? "circular"] ?? 2,
    pausing: Number(p.pause_seconds ?? 0),
    isEnableVibrationBefore: p.agitate_before ? 1 : 2,
    isEnableVibrationAfter: p.agitate_after ? 1 : 2,
  }));
}

async function listRecipes(creds: UserCredentials): Promise<string> {
  const payload = { ...authBase(creds), pageNumber: 1, countPerPage: 100, adaptedModel: 1 };
  const resp = await postEncrypted("tuMyTeaRecipeCreated.tuhtml", payload);
  if (resp.result === "success") {
    const recipes = (resp.list as Record<string, unknown>[]) || [];
    if (!recipes.length) return "No recipes found.";
    const lines = [`Found ${recipes.length} recipes:\n`];
    for (const r of recipes) {
      lines.push(`  [${r.tableId}] ${r.theName} — ${r.dose}g, 1:${r.grandWater}, grind ${r.grinderSize}, rpm ${r.rpm}`);
      if (r.shareRecipeLink) lines.push(`    Share: ${r.shareRecipeLink}`);
    }
    return lines.join("\n");
  }
  return `Failed to list recipes. Your session may have expired — try logging in again.`;
}

async function createRecipe(args: Record<string, unknown>, creds: UserCredentials): Promise<string> {
  const pourList = buildPourList(args.pours as Pour[]);
  const payload = {
    ...authBase(creds),
    theName: args.name,
    dose: Number(args.dose_g),
    grandWater: Number(args.ratio),
    grinderSize: Number(args.grind_size),
    rpm: Number(args.grind_rpm),
    cupType: 2,
    adaptedModel: 1,
    isEnableBypassWater: 2,
    isSetGrinderSize: 1,
    theColor: (args.color as string) || "#C9D5B8",
    theSubsetId: 0,
    bypassTemp: 85.0,
    bypassVolume: 5.0,
    subSetType: 2,
    appPlace: [4],
    createTimeStamp: Date.now(),
    isShortcuts: 2,
    pourDataJSONStr: JSON.stringify(pourList),
  };
  const resp = await postEncrypted("tuRecipeAdd.tuhtml", payload);
  if (resp.result === "success") {
    const shareId = btoa(String(resp.tableId));
    return `Recipe '${args.name}' created!\nShare: ${SHARE_BASE}/?id=${encodeURIComponent(shareId)}`;
  }
  return `Failed. Your session may have expired — try logging in again.`;
}

async function createTeaRecipe(args: Record<string, unknown>, creds: UserCredentials): Promise<string> {
  const steeps = (args.steeps as Array<Record<string, unknown>>) || [];
  const pourList = steeps.map((s, i) => ({
    theName: i === 0 ? "Steep 1" : `Steep ${i + 1}`,
    volume: Math.min(Number(s.volume_ml ?? 80), 90),
    temperature: Number(s.temperature_c ?? 85),
    flowRate: Number(s.flow_rate ?? 3.0),
    pattern: 3, // circular
    pausing: Math.min(Number(s.steep_seconds ?? 120), 360),
    isEnableVibrationBefore: 2,
    isEnableVibrationAfter: 2,
  }));
  const payload = {
    ...authBase(creds),
    theName: args.name,
    dose: Math.min(Number(args.dose_g), 10),
    grandWater: Number(args.ratio),
    grinderSize: 50,
    rpm: 60,
    cupType: 4,
    adaptedModel: 1,
    isEnableBypassWater: 2,
    isSetGrinderSize: 2,
    theColor: (args.color as string) || "#A8C686",
    theSubsetId: 0,
    bypassTemp: 85.0,
    bypassVolume: 5.0,
    subSetType: 2,
    appPlace: [4],
    createTimeStamp: Date.now(),
    isShortcuts: 2,
    pourDataJSONStr: JSON.stringify(pourList),
  };
  const resp = await postEncrypted("tuRecipeAdd.tuhtml", payload);
  if (resp.result === "success") {
    const shareId = btoa(String(resp.tableId));
    return `Tea recipe '${args.name}' created!\nShare: ${SHARE_BASE}/?id=${encodeURIComponent(shareId)}`;
  }
  return `Failed. Your session may have expired — try logging in again.`;
}

async function editRecipe(args: Record<string, unknown>, creds: UserCredentials): Promise<string> {
  const recipeId = args.recipe_id as number;
  const listPayload = { ...authBase(creds), pageNumber: 1, countPerPage: 100, adaptedModel: 1 };
  const listResp = await postEncrypted("tuMyTeaRecipeCreated.tuhtml", listPayload);
  let current: Record<string, unknown> | null = null;
  if (listResp.result === "success") {
    for (const r of (listResp.list as Record<string, unknown>[]) || []) {
      if (r.tableId === recipeId) { current = r; break; }
    }
  }
  if (!current) return `Recipe [${recipeId}] not found.`;

  const payload: Record<string, unknown> = {
    ...authBase(creds),
    tableId: recipeId,
    theName: (args.name as string) || current.theName,
    dose: args.dose_g && Number(args.dose_g) > 0 ? Number(args.dose_g) : Number(current.dose),
    grandWater: args.ratio && Number(args.ratio) > 0 ? Number(args.ratio) : Number(current.grandWater),
    grinderSize: args.grind_size && Number(args.grind_size) > 0 ? Number(args.grind_size) : Number(current.grinderSize),
    rpm: args.grind_rpm && Number(args.grind_rpm) > 0 ? Number(args.grind_rpm) : Number(current.rpm),
    theColor: (args.color as string) || current.theColor || "#C9D5B8",
    cupType: 2,
    adaptedModel: 1,
    isEnableBypassWater: 2,
    isSetGrinderSize: 1,
    theSubsetId: current.theSubsetId ?? 0,
    bypassTemp: current.bypassTemp ?? 85.0,
    bypassVolume: current.bypassVolume ?? 5.0,
    subSetType: 2,
    appPlace: [4],
    isShortcuts: current.isShortcuts ?? 2,
  };

  if (args.pours) {
    payload.pourDataJSONStr = JSON.stringify(buildPourList(args.pours as Pour[]));
  } else {
    const existing = (current.pourList as Record<string, unknown>[]) || [];
    payload.pourDataJSONStr = JSON.stringify(existing.map(p => ({
      theName: p.theName,
      volume: Number(p.volume ?? 30),
      temperature: Number(p.temperature ?? 93),
      flowRate: Number(p.flowRate ?? 3.0),
      pattern: Number(p.pattern ?? 2),
      pausing: Number(p.pausing ?? 0),
      isEnableVibrationBefore: Number(p.isEnableVibrationBefore ?? 2),
      isEnableVibrationAfter: Number(p.isEnableVibrationAfter ?? 2),
    })));
  }

  const resp = await postEncrypted("tuRecipeUpdate.tuhtml", payload);
  if (resp.result === "success") return `Recipe [${recipeId}] updated!`;
  return `Failed. Your session may have expired — try logging in again.`;
}

async function deleteRecipe(args: Record<string, unknown>, creds: UserCredentials): Promise<string> {
  const resp = await postEncrypted("tuRecipeDelete.tuhtml", { ...authBase(creds), tableId: args.recipe_id });
  if (resp.result === "success") return `Recipe [${args.recipe_id}] deleted.`;
  return `Failed. Your session may have expired — try logging in again.`;
}

async function fetchRecipe(args: Record<string, unknown>): Promise<string> {
  let shareId: string | null = args.share_url as string;
  if (shareId.includes("share-h5.xbloom.com")) {
    const url = new URL(shareId);
    shareId = url.searchParams.get("id");
  }
  if (!shareId) return `Could not parse share ID from: ${args.share_url}`;

  const resp = await postPlain("RecipeDetail.html", { tableIdOfRSA: shareId, interfaceVersion: 19700101, skey: "testskey" });
  if (resp.result === "success") {
    const rv = resp.recipeVo as Record<string, unknown>;
    const pourList = (rv.pourList as Record<string, unknown>[]) || [];
    return JSON.stringify({
      name: rv.theName ?? "Imported Recipe",
      dose_g: rv.dose ?? 15,
      ratio: rv.grandWater ?? 15,
      grind_size: rv.grinderSize ?? 70,
      grind_rpm: rv.rpm ?? 80,
      cup_type: "omni",
      pours: pourList.map(p => ({
        volume_ml: p.volume ?? 30,
        temperature_c: p.temperature ?? 93,
        pattern: PATTERN_REV[Number(p.pattern ?? 2)] ?? "circular",
        flow_rate: p.flowRate ?? 3.0,
        pause_seconds: p.pausing ?? 0,
        agitate_before: p.isEnableVibrationBefore === 1,
        agitate_after: p.isEnableVibrationAfter === 1,
      })),
    }, null, 2);
  }
  return `Failed. Your session may have expired — try logging in again.`;
}

async function updatePreferences(args: Record<string, unknown>): Promise<string> {
  try {
    const content = args.content as string;
    await Deno.writeTextFile("/app/data/user-preferences.md", content);
    userPreferences = content;
    return "User preferences updated successfully.";
  } catch (e) {
    return `Failed to update preferences: ${String(e)}`;
  }
}

async function readResource(args: Record<string, unknown>): Promise<string> {
  const resource = args.resource as string;
  switch (resource) {
    case "user-preferences":
      try {
        return await Deno.readTextFile("/app/data/user-preferences.md");
      } catch (e) {
        return `Failed to read user preferences: ${String(e)}`;
      }
    case "brewing-reference":
      return brewingReference || "Brewing reference not loaded.";
    case "custom-instructions":
      return customInstructions || "Custom instructions not loaded.";
    default:
      return `Unknown resource: ${resource}`;
  }
}

// --- Tool dispatch ---

async function handleToolCall(params: Record<string, unknown>) {
  const name = params.name as string;
  const args = (params.arguments as Record<string, unknown>) || {};

  try {
    // Fetch recipe doesn't require auth
    if (name === "xbloom_fetch_recipe") {
      return { content: [{ type: "text", text: await fetchRecipe(args) }] };
    }

    if (name === "xbloom_read_resource") {
      return { content: [{ type: "text", text: await readResource(args) }] };
    }
    
    if (name === "xbloom_update_preferences") {
      return { content: [{ type: "text", text: await updatePreferences(args) }] };
    }

    // All other tools require cached credentials
    if (!cachedCredentials) {
      await initCredentials();
    }

    if (!cachedCredentials) {
      return {
        content: [{ type: "text", text: "XBloom login failed. Check XBLOOM_EMAIL and XBLOOM_PASSWORD environment variables." }],
        isError: true,
      };
    }

    let result: string;
    switch (name) {
      case "xbloom_list_recipes": result = await listRecipes(cachedCredentials); break;
      case "xbloom_create_recipe": result = await createRecipe(args, cachedCredentials); break;
      case "xbloom_create_tea_recipe": result = await createTeaRecipe(args, cachedCredentials); break;
      case "xbloom_edit_recipe": result = await editRecipe(args, cachedCredentials); break;
      case "xbloom_delete_recipe": result = await deleteRecipe(args, cachedCredentials); break;
      default: return { content: [{ type: "text", text: `Unknown tool: ${name}` }], isError: true };
    }
    return { content: [{ type: "text", text: result }] };
  } catch (e) {
    return { content: [{ type: "text", text: `Error: ${String(e)}` }], isError: true };
  }
}

// --- JSON-RPC helpers ---

function jsonRpcOk(id: unknown, result: unknown) {
  return new Response(JSON.stringify({ jsonrpc: "2.0", id, result }), {
    headers: { "Content-Type": "application/json" },
  });
}

function jsonRpcErr(id: unknown, code: number, message: string) {
  return new Response(JSON.stringify({ jsonrpc: "2.0", id, error: { code, message } }), {
    headers: { "Content-Type": "application/json" },
  });
}

// --- Session ID generation ---

function generateToken(): string {
  const arr = new Uint8Array(32);
  crypto.getRandomValues(arr);
  return Array.from(arr, b => b.toString(16).padStart(2, "0")).join("");
}


// --- Main handler ---

const BASE_URL = Deno.env.get("MCP_BASE_URL") || "http://localhost:8000";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, Mcp-Session-Id",
};

function jsonResponse(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status, headers: { "Content-Type": "application/json", ...CORS_HEADERS },
  });
}

// --- SSE transport ---
// Claude Desktop uses SSE: client GETs /sse to open a stream,
// server sends an "endpoint" event with a POST URL,
// client POSTs JSON-RPC messages to that URL,
// server sends responses as SSE "message" events on the stream.

// Per-session message queues for SSE transport
const sseSessions = new Map<string, { controller: ReadableStreamDefaultController }>();

async function handleMcpMessage(body: Record<string, unknown>): Promise<Record<string, unknown> | null> {
  const method = body.method as string;
  const id = body.id;
  const params = (body.params as Record<string, unknown>) || {};

  switch (method) {
    case "initialize":
      return { jsonrpc: "2.0", id, result: {
        protocolVersion: "2024-11-05",
        capabilities: { tools: {}, resources: {} },
        serverInfo: { name: "xbloom", version: "2.0.0" },
      }};
    case "notifications/initialized":
      return null; // No response for notifications
    case "tools/list":
      return { jsonrpc: "2.0", id, result: { tools: TOOLS } };
    case "tools/call":
      return { jsonrpc: "2.0", id, result: await handleToolCall(params) };  
    case "resources/list":
      return { jsonrpc: "2.0", id, result: { resources: [
        {
          uri: "xbloom://resources/brewing-reference",
          name: "xBloom Brewing Reference",
          description: "Comprehensive brewing science reference for xBloom recipe creation",
          mimeType: "text/markdown",
        },
        {
          uri: "xbloom://resources/custom-instructions",
          name: "xBloom Custom Instructions",
          description: "Recipe manager instructions and parameter guidelines",
          mimeType: "text/markdown",
        },
        {
          uri: "xbloom://resources/user-preferences",
          name: "xBloom User Preferences",
          description: "Persistent user preferences and bean history",
          mimeType: "text/markdown",
        },
      ]}};
    case "resources/read": {
      const uri = (params.uri as string) || "";
      if (uri === "xbloom://resources/brewing-reference") {
        return { jsonrpc: "2.0", id, result: { contents: [{ uri, mimeType: "text/markdown", text: brewingReference }] }};
      }
      if (uri === "xbloom://resources/custom-instructions") {
        return { jsonrpc: "2.0", id, result: { contents: [{ uri, mimeType: "text/markdown", text: customInstructions }] }};
      }
      if (uri === "xbloom://resources/user-preferences") {
        return { jsonrpc: "2.0", id, result: { contents: [{ uri, mimeType: "text/markdown", text: userPreferences }] }};
      }
      return { jsonrpc: "2.0", id, error: { code: -32602, message: `Unknown resource: ${uri}` }};
    }
    default:
      return { jsonrpc: "2.0", id, error: { code: -32601, message: `Method not found: ${method}` } };
  }
}

await initCredentials();

Deno.serve(async (req: Request) => {
  const url = new URL(req.url);
  const path = url.pathname;

  if (req.method === "OPTIONS") {
    return new Response(null, { headers: CORS_HEADERS });
  }

  // Handle DELETE for SSE session cleanup
  if (req.method === "DELETE") {
    return new Response(null, { status: 200, headers: CORS_HEADERS });
  }

  // OAuth discovery
  if (req.method === "GET" && (path.endsWith("/.well-known/oauth-protected-resource") || path.includes("oauth-protected-resource"))) {
    return jsonResponse(oauthDiscoveryResource());
  }
  if (req.method === "GET" && (path.endsWith("/.well-known/oauth-authorization-server") || path.includes("oauth-authorization-server"))) {
    return jsonResponse(oauthDiscoveryServer());
  }

  // OAuth endpoints
  if (req.method === "GET" && path.endsWith("/authorize")) return handleAuthorize(url);
  if (req.method === "POST" && path.endsWith("/token")) return handleToken(req);
  if (req.method === "POST" && path.endsWith("/register")) {
    let body: Record<string, unknown> = {};
    try { 
      body = await req.json(); 
    } catch { /* ok */ }
    return handleRegister(body);
  }

  // --- SSE transport ---
  // GET /sse — open SSE stream, send endpoint URL
  if (req.method === "GET" && path.endsWith("/sse")) {
    const sessionId = generateToken();

    const stream = new ReadableStream({
      start(controller) {
        // Store session
        sseSessions.set(sessionId, { controller });

        // Send endpoint event — tells client where to POST messages
        const endpointUrl = `${BASE_URL}/message?sessionId=${sessionId}`;
        controller.enqueue(new TextEncoder().encode(`event: endpoint\ndata: ${endpointUrl}\n\n`));
      },
      cancel() {
        sseSessions.delete(sessionId);
      },
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        "Connection": "keep-alive",
        ...CORS_HEADERS,
      },
    });
  }

  // POST /message?sessionId=xxx — receive JSON-RPC, send response via SSE stream
  if (req.method === "POST" && path.endsWith("/message")) {
    const sessionId = url.searchParams.get("sessionId") || "";
    const session = sseSessions.get(sessionId);

    if (!session) {
      return new Response(JSON.stringify({ error: "Invalid session" }), {
        status: 400, headers: { "Content-Type": "application/json", ...CORS_HEADERS },
      });
    }

    let body: Record<string, unknown>;
    try { body = await req.json(); } catch {
      return new Response(JSON.stringify({ error: "Parse error" }), {
        status: 400, headers: { "Content-Type": "application/json", ...CORS_HEADERS },
      });
    }

    const response = await handleMcpMessage(body);

    if (response) {
      // Send response as SSE event on the stream
      const data = JSON.stringify(response);
      try {
        session.controller.enqueue(new TextEncoder().encode(`event: message\ndata: ${data}\n\n`));
      } catch {
        // Stream closed
        sseSessions.delete(sessionId);
      }
    }

    // Acknowledge the POST
    return new Response(null, { status: 202, headers: CORS_HEADERS });
  }

  // --- Streamable HTTP transport (POST to root) ---

  // Health
  if (req.method === "GET") {
    const accept = req.headers.get("accept") || "";
    if (accept.includes("text/event-stream")) {
      // MCP Streamable HTTP transport - open SSE stream
      const stream = new ReadableStream({
        start(controller) {
          // Keep stream open - Claude will send tool calls via POST
        },
        cancel() {},
      });
      return new Response(stream, {
        headers: {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
          "Connection": "keep-alive",
          ...CORS_HEADERS,
        },
      });
    }
    return jsonResponse({ name: "xbloom-mcp", status: "ok" });
  }
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });
  
  // Require bearer token for MCP requests
  const auth = req.headers.get("authorization") || "";
  if (!auth.startsWith("Bearer ") || auth.slice(7) !== MCP_AUTH_TOKEN) {
    return new Response(JSON.stringify({ error: "unauthorized" }), {
      status: 401,
      headers: {
        ...CORS_HEADERS,
        "WWW-Authenticate": `Bearer realm="${BASE_URL}"`,
        "Content-Type": "application/json",
      },
    });
  }

  // MCP JSON-RPC over POST
  let sessionKey = req.headers.get("mcp-session-id") || "";

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return jsonRpcErr(null, -32700, "Parse error"); }

  // On initialize, generate a session ID if client doesn't have one
  const method = body.method as string;
  if (method === "initialize" && !sessionKey) {
    sessionKey = generateToken();
  }

  const response = await handleMcpMessage(body);
  if (!response) return new Response(null, { status: 204, headers: CORS_HEADERS });

  const headers: Record<string, string> = { "Content-Type": "application/json", ...CORS_HEADERS };
  if (method === "initialize" && sessionKey) {
    headers["Mcp-Session-Id"] = sessionKey;
  }

  return new Response(JSON.stringify(response), { headers });
});
