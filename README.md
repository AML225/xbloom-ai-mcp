# xbloom-ai-mcp

> This is an unofficial, community-built MCP server. It is not affiliated with or endorsed by xBloom.
> This project originated as a fork of [denull0/xbloom-agent](https://github.com/denull0/xbloom-agent) and has since been substantially rewritten.

An MCP (Model Context Protocol) server that connects Claude to your xBloom Studio coffee machine. Create, edit, and manage coffee and tea recipes through conversation and they sync directly to the xBloom iOS app.

---

## Prerequisites

- Docker and Docker Compose
- A domain name with HTTPS (or a reverse proxy like Caddy)
- An xBloom account
- A Claude Pro, Max, Team, or Enterprise plan

---

## Installation

### 1. (Optional) Create a data directory

A data directory is only required if you want persistent user preferences. This involves a markdown file where Claude can store your brewing preferences, bean history, and tasting notes across container updates. File will be created on first run and updated by Claude periodically. File can be updated by user at any time.
```bash
mkdir -p /path/to/xbloom-data
```

If you skip this step, the server will still work fully. It is only required to have persistent preferences. If you add the volume mount later, the server will automatically create a preferences file from the template on first run.

### 2. Create your compose file

Copy `compose.yaml` from this repo and fill in your values via a `.env` file. See `.env.example` for all required variables. If you created a data directory, update the volume mount path in `compose.yaml`.

### 3. Generate secrets
```bash
openssl rand -hex 32  # use for MCP_AUTH_TOKEN
openssl rand -hex 32  # use for OAUTH_CLIENT_SECRET
```

### 4. Start the container
```bash
docker compose up -d
```

---

## Configuration

| Variable | Required | Description |
|----------|----------|-------------|
| `XBLOOM_EMAIL` | Yes | Your xBloom account email |
| `XBLOOM_PASSWORD` | Yes | Your xBloom account password |
| `MCP_BASE_URL` | Yes | Public HTTPS URL of your server (e.g. `https://coffee.yourdomain.com`) |
| `MCP_AUTH_TOKEN` | Yes | Bearer token for MCP requests** |
| `OAUTH_CLIENT_SECRET` | Yes | Secret entered when adding the Claude connector** | 

**generate with `openssl rand -hex 32` 

---

## Cloudflare

If your domain is proxied through Cloudflare, you must allow Claude's user agent in your bot management rules. In your Cloudflare dashboard under Security, find the managed "Manage AI bots" rule or "AI Crawl Control" settings and set `Claude-User` to **Allow**. Without this, Cloudflare will block all requests from Claude's infrastructure.

---

## Connecting Claude

1. Go to Claude.ai → Settings → Connectors → Add custom connector
2. Enter your `MCP_BASE_URL` as the server URL
3. Click **Advanced settings** and enter:
   - **OAuth Client ID:** `xbloom-mcp-client`
   - **OAuth Client Secret:** your `OAUTH_CLIENT_SECRET` value
4. Click **Add** and complete the OAuth flow

Only someone who knows the `OAUTH_CLIENT_SECRET` can successfully add the connector.

---

## Tools

| Tool | Description |
|------|-------------|
| `xbloom_list_recipes` | List all recipes with IDs |
| `xbloom_create_recipe` | Create a new coffee recipe |
| `xbloom_create_tea_recipe` | Create a new tea recipe |
| `xbloom_edit_recipe` | Edit an existing recipe by ID |
| `xbloom_delete_recipe` | Delete a recipe |
| `xbloom_fetch_recipe` | Import a recipe from a share URL |
| `xbloom_update_preferences` | Write to the persistent user preferences file |
| `xbloom_read_resource` | Read server resource files (preferences, brewing reference, custom instructions) |

---

## License

MIT. See original project for prior copyright notices.
