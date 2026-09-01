import http from "node:http";
import { spawn } from "node:child_process";
import { Readable } from "node:stream";

const PUBLIC_PORT = Number(process.env.PORT || 8080);
const INNER_PORT = 8081;
const PUBLIC_URL = (process.env.MCP_PUBLIC_URL || "https://post-for-me-mcp-production.up.railway.app").replace(/\/$/, "");
const SUPABASE_URL = (process.env.SUPABASE_URL || "").replace(/\/$/, "");
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || "";
const ALLOWED_USER_ID = process.env.OAUTH_ALLOWED_USER_ID || "";
const POST_FOR_ME_API_KEY = process.env.POST_FOR_ME_API_KEY || "";
const AUTHORIZATION_SERVER = `${SUPABASE_URL}/auth/v1`;

for (const [name, value] of Object.entries({
  SUPABASE_URL,
  SUPABASE_ANON_KEY,
  OAUTH_ALLOWED_USER_ID: ALLOWED_USER_ID,
})) {
  if (!value) {
    console.error(`Missing required environment variable: ${name}`);
    process.exit(1);
  }
}

const inner = spawn(
  "./node_modules/.bin/mcp-server",
  [
    "--transport=http",
    `--port=${INNER_PORT}`,
    "--code-execution-mode=local",
    "--docs-search-mode=local",
  ],
  {
    env: {
      ...process.env,
      PORT: String(INNER_PORT),
      MCP_SERVER_TRANSPORT: "http",
      MCP_SERVER_CODE_EXECUTION_MODE: "local",
      MCP_SERVER_DOCS_SEARCH_MODE: "local",
    },
    stdio: "inherit",
  },
);

inner.on("exit", (code, signal) => {
  console.error(`Inner MCP server exited (code=${code}, signal=${signal})`);
  process.exit(code ?? 1);
});

function sendJson(res, status, value, extraHeaders = {}) {
  const body = JSON.stringify(value);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(body),
    ...extraHeaders,
  });
  res.end(body);
}

function sendUnauthorized(res) {
  sendJson(
    res,
    401,
    {
      error: "unauthorized",
      error_description: "A valid OAuth access token is required.",
    },
    {
      "www-authenticate": `Bearer resource_metadata="${PUBLIC_URL}/.well-known/oauth-protected-resource", scope="openid email profile"`,
    },
  );
}

async function authenticate(req) {
  const authorization = req.headers.authorization;
  if (!authorization || !authorization.startsWith("Bearer ")) return null;

  const token = authorization.slice("Bearer ".length).trim();
  if (!token) return null;

  const response = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: {
      authorization: `Bearer ${token}`,
      apikey: SUPABASE_ANON_KEY,
    },
    signal: AbortSignal.timeout(10_000),
  });

  if (!response.ok) return null;
  const user = await response.json();
  if (!user?.id || user.id !== ALLOWED_USER_ID) return null;
  return user;
}

async function readBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  return chunks.length ? Buffer.concat(chunks) : undefined;
}

async function proxyToInner(req, res) {
  if (!POST_FOR_ME_API_KEY) {
    return sendJson(res, 503, {
      error: "post_for_me_api_key_not_configured",
      error_description: "The MCP server is authenticated, but its Post for Me API key is not configured yet.",
    });
  }

  const headers = new Headers();
  for (const [key, rawValue] of Object.entries(req.headers)) {
    const lower = key.toLowerCase();
    if (["host", "authorization", "content-length", "connection", "transfer-encoding"].includes(lower)) continue;
    if (rawValue === undefined) continue;
    if (Array.isArray(rawValue)) {
      for (const value of rawValue) headers.append(key, value);
    } else {
      headers.set(key, rawValue);
    }
  }
  headers.set("authorization", `Bearer ${POST_FOR_ME_API_KEY}`);

  const method = req.method || "POST";
  const body = method === "GET" || method === "HEAD" ? undefined : await readBody(req);

  const upstream = await fetch(`http://127.0.0.1:${INNER_PORT}${req.url || "/"}`, {
    method,
    headers,
    body,
    redirect: "manual",
    signal: AbortSignal.timeout(120_000),
  });

  const responseHeaders = {};
  for (const [key, value] of upstream.headers.entries()) {
    const lower = key.toLowerCase();
    if (["connection", "transfer-encoding", "content-length"].includes(lower)) continue;
    responseHeaders[key] = value;
  }

  res.writeHead(upstream.status, responseHeaders);
  if (!upstream.body) {
    res.end();
    return;
  }

  Readable.fromWeb(upstream.body).pipe(res);
}

const server = http.createServer(async (req, res) => {
  try {
    const pathname = new URL(req.url || "/", PUBLIC_URL).pathname;

    if (pathname === "/health") {
      res.writeHead(200, { "content-type": "text/plain; charset=utf-8" });
      res.end("OK");
      return;
    }

    if (pathname === "/.well-known/oauth-protected-resource") {
      sendJson(res, 200, {
        resource: PUBLIC_URL,
        authorization_servers: [AUTHORIZATION_SERVER],
        scopes_supported: ["openid", "email", "profile"],
        bearer_methods_supported: ["header"],
      });
      return;
    }

    const user = await authenticate(req).catch((error) => {
      console.error("OAuth token validation failed:", error instanceof Error ? error.message : String(error));
      return null;
    });

    if (!user) {
      sendUnauthorized(res);
      return;
    }

    await proxyToInner(req, res);
  } catch (error) {
    console.error("OAuth MCP gateway error:", error);
    if (!res.headersSent) {
      sendJson(res, 502, { error: "bad_gateway" });
    } else {
      res.destroy();
    }
  }
});

server.listen(PUBLIC_PORT, "0.0.0.0", () => {
  console.log(`OAuth MCP gateway listening on port ${PUBLIC_PORT}`);
  console.log(`OAuth authorization server: ${AUTHORIZATION_SERVER}`);
});

function shutdown(signal) {
  console.log(`Received ${signal}; shutting down`);
  inner.kill(signal);
  server.close(() => process.exit(0));
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
