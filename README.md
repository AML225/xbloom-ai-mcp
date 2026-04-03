# xbloom-ai-mcp

An unofficial, community-built MCP (Model Context Protocol) server for xBloom Studio coffee machines. This project is not affiliated with or endorsed by xBloom.

This project originated as a fork of [denull0/xbloom-agent](https://github.com/denull0/xbloom-agent) and has since been substantially rewritten as a self-hosted, single-user Docker deployment.

## What it does

Connects Claude to your xBloom account via the MCP protocol, allowing you to manage your coffee and tea recipes through conversation. The server handles authentication with the xBloom API using your account credentials, stored securely as environment variables.

### Available tools

| Tool | Description |
|------|-------------|
| `xbloom_list_recipes` | List all recipes on your account |
| `xbloom_create_recipe` | Create a new coffee recipe |
| `xbloom_create_tea_recipe` | Create a new tea recipe |
| `xbloom_edit_recipe` | Edit an existing recipe by ID |
| `xbloom_delete_recipe` | Delete a recipe |
| `xbloom_fetch_recipe` | Import a recipe from a share URL |

## License

MIT. See original project for prior copyright notices.