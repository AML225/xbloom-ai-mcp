# XBloom MCP Server
FROM denoland/deno:2.3.3

WORKDIR /app

# Copy source
COPY xbloom-mcp-server/index.ts .
COPY xbloom-mcp-server/oauth.ts .

# Pre-cache dependencies
RUN deno cache index.ts

EXPOSE 8000

CMD ["deno", "run", "--allow-net", "--allow-env", "index.ts"]