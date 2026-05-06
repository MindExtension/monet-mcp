import { createMcpHandler } from "mcp-handler";
import { ALL_TOOLS, MCP_CONTENT } from "@/src/tools";

const handler = createMcpHandler(
  (server) => {
    for (const t of ALL_TOOLS) {
      const shape = ((t.schema as any).shape ?? {}) as Record<string, unknown>;
      const cb = (async (args: unknown, extra: unknown) => {
        // mcp-handler attaches the original Fetch Request as extra.requestInfo.
        // requestInfo.headers may be a plain object (Record<string,string>) OR a
        // Headers instance depending on transport. Normalize to Headers.
        const e = extra as
          | { request?: Request; requestInfo?: { headers?: Headers | Record<string, string | string[]> } }
          | undefined;
        let headers: Headers;
        const rawHeaders = e?.requestInfo?.headers ?? e?.request?.headers;
        if (rawHeaders instanceof Headers) {
          headers = rawHeaders;
        } else if (rawHeaders && typeof rawHeaders === "object") {
          headers = new Headers();
          for (const [k, v] of Object.entries(rawHeaders)) {
            if (Array.isArray(v)) v.forEach((vv) => headers.append(k, vv));
            else if (typeof v === "string") headers.set(k, v);
          }
        } else {
          headers = new Headers();
        }
        const result = await t.handler(args, { headers });
        // If handler signals raw MCP content (e.g. binary file download), forward as-is.
        if (
          result &&
          typeof result === "object" &&
          (result as Record<string, unknown>)[MCP_CONTENT] === true
        ) {
          return {
            content: (result as { content: unknown[] }).content as never,
          };
        }
        return {
          content: [
            {
              type: "text" as const,
              text:
                typeof result === "string"
                  ? result
                  : JSON.stringify(result, null, 2),
            },
          ],
        };
      }) as never;
      (server.tool as any)(t.name, t.description, shape, cb);
    }
  },
  {
    serverInfo: {
      name: "monet-mcp",
      version: "0.1.0",
    },
  },
  {
    // base path for the handler — Next routes /api/<transport>
    basePath: "/api",
    verboseLogs: process.env.LOG_LEVEL === "debug",
    maxDuration: 60,
  },
);

export { handler as GET, handler as POST, handler as DELETE };
