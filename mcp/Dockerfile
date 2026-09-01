FROM node:24-bookworm-slim

WORKDIR /app

RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates \
  && rm -rf /var/lib/apt/lists/* \
  && npm init -y \
  && npm install --omit=dev post-for-me-mcp@2.9.1 deno@2.9.6

ENV PATH="/app/node_modules/.bin:${PATH}"
ENV MCP_SERVER_TRANSPORT=http
ENV MCP_SERVER_CODE_EXECUTION_MODE=local
ENV MCP_SERVER_DOCS_SEARCH_MODE=local

EXPOSE 8080

CMD ["sh", "-c", "./node_modules/.bin/mcp-server --transport=http --port=${PORT:-8080} --code-execution-mode=local --docs-search-mode=local"]
