# XBloom + Claude

Let Claude create custom pour-over recipes for your XBloom Studio coffee machine. Just tell Claude about your coffee — or snap a photo of the bag — and it designs a recipe that syncs straight to your xBloom app.

No coding needed. Works on Claude desktop, mobile, and web.

---

## Get Started

### Step 1: Connect to Claude

Open Claude and add this server URL in your integrations settings:

```
https://ramaokxdyszcqpqxmosv.supabase.co/functions/v1/xbloom-mcp
```

**Where to find it:**
- **Desktop app** — Settings > Integrations > Add
- **iPhone / Android** — Settings > Integrations > Add
- **claude.ai** — Profile > Settings > Integrations > Add

Approve the connection when prompted.

### Step 2: Sign in with your XBloom account

The first time you use it, Claude will ask for your XBloom email and password. This links your XBloom account so recipes go directly to **your** app. Your password is used once and **never saved**.

### Step 3: Start chatting

Ask Claude to make you a recipe. Here are some ideas:

> *"Here's a photo of my coffee bag. Make me a recipe for it."*

> *"I have a medium roast Colombian, 18g dose. I like it bright and clean."*

> *"That last brew was a little bitter — can you adjust?"*

> *"Show me all my recipes."*

> *"Delete the old test recipe."*

Claude uses brewing science (Kasuya 4:6, Hoffmann, Rao, etc.) to design recipes matched to your beans. Recipes sync instantly to the **xBloom iOS app** and are ready to brew.

### What can it do?

- **Photo-to-recipe** — Take a photo of your coffee bag, Claude reads the label and creates a recipe
- **Link-to-recipe** — Paste a product link, Claude pulls the details and designs a recipe
- **Taste adjustments** — Tell Claude it was too bitter/sour/weak and it tweaks the recipe
- **Manage recipes** — List, edit, and delete recipes right from the chat
- **Import recipes** — Grab any shared XBloom recipe by URL

### Privacy

- Your password is **never stored** — it's used once to log in, then thrown away
- Each user has their own account — nobody else can see or touch your recipes
- Session tokens are encrypted at rest

---

## Developer Guide

Everything below is for developers who want to self-host or modify the server.

### Tech Stack

- **Runtime**: Deno 2.x on Supabase Edge Functions
- **Protocol**: MCP 2.0 (Streamable HTTP + SSE)
- **Auth**: OAuth 2.0 + per-user XBloom login
- **Encryption**: AES-256-CBC (sessions) + RSA (API payloads, XBloom's key)

### MCP Tools

| Tool | Description |
|------|-------------|
| `xbloom_login` | Authenticate with your XBloom account |
| `xbloom_list_recipes` | List all your recipes with IDs |
| `xbloom_create_recipe` | Create a new recipe and push to cloud |
| `xbloom_edit_recipe` | Update an existing recipe by ID |
| `xbloom_delete_recipe` | Permanently remove a recipe |
| `xbloom_fetch_recipe` | Import a recipe from a share URL |

### Self-Hosting

#### Prerequisites

- [Supabase CLI](https://supabase.com/docs/guides/cli/getting-started)
- [Deno 2.x](https://deno.com)

#### 1. Clone and deploy

```bash
git clone https://github.com/denull0/xbloom-agent.git
cd xbloom-agent/xbloom-mcp-remote
supabase functions deploy xbloom-mcp --no-verify-jwt
```

#### 2. Create the sessions table

```sql
CREATE TABLE user_sessions (
  access_token TEXT PRIMARY KEY,
  encrypted_creds TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE user_sessions ENABLE ROW LEVEL SECURITY;
```

No environment variables needed — the server uses `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` which are automatically available in edge functions.

#### 3. Connect Claude

Add your server URL in Claude integrations:

```
https://<your-project>.supabase.co/functions/v1/xbloom-mcp
```

### Project Structure

```
xbloom-agent/
├── xbloom-mcp-remote/
│   └── supabase/
│       ├── config.toml                     # Supabase project config
│       └── functions/
│           └── xbloom-mcp/index.ts         # MCP server (OAuth + tools + SSE)
└── xbloom-recipes/
    └── claude-project/
        ├── custom-instructions.md          # Claude project instructions
        └── xbloom-brewing-reference.md     # Coffee brewing science reference
```

### Recipe Parameters

All recipes target the **Omni dripper**. Hardware constraints:

| Parameter | Range | Notes |
|-----------|-------|-------|
| `grind_size` | 40–120 | Lower = finer |
| `grind_rpm` | 60–120 | Grinder speed |
| `dose_g` | 1–31 | Coffee dose in grams |
| `temperature_c` | 40–95 | Water temperature |
| `flow_rate` | 3.0–3.5 | mL/s |
| `pattern` | centered, circular, spiral | Pour pattern |
| `pause_seconds` | 0–255 | Pause between pours |

### Security

- Passwords are **never stored** — used once for XBloom API login, then discarded
- Session tokens are **AES-256 encrypted** at rest using HMAC-SHA256 derived keys
- Database table has **Row Level Security** — only the server can access it
- Error messages are sanitized — no internal API details leaked

## License

MIT
