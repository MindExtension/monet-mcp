/**
 * MonetAPI v2 client.
 *
 * Stateless multi-tenant: every call carries the requesting user's credentials
 * and target company ID, both extracted from MCP request headers.
 *
 * Monet stores the active company server-side per user account. To work safely
 * with users who may have multiple companies, we always switch to the target
 * company before each request. We do NOT restore on a per-request basis since
 * each MCP tool call is independent and stateless. Users who care should pin
 * their MCP config to the company they want.
 */

const DEFAULT_BASE_URL =
  process.env.MONET_BASE_URL ??
  "https://e.monet.lt/DesktopModules/MonetServices2/API/V2";

export interface MonetCreds {
  user: string;
  pass: string;
  /** Company ID. If omitted, uses whatever's currently active for that user. */
  company?: string;
  baseUrl: string;
}

export class MonetError extends Error {
  constructor(
    public status: number,
    public bodyText: string,
    message?: string,
  ) {
    super(message ?? `Monet API ${status}: ${bodyText.slice(0, 300)}`);
  }
}

function authHeader(c: MonetCreds): string {
  return "Basic " + Buffer.from(`${c.user}:${c.pass}`).toString("base64");
}

async function rawRequest(
  c: MonetCreds,
  method: string,
  path: string,
  init: { params?: Record<string, string | number | boolean | undefined>; body?: unknown } = {},
): Promise<{ status: number; text: string; json: unknown }> {
  const url = new URL(`${c.baseUrl}${path}`);
  if (init.params) {
    for (const [k, v] of Object.entries(init.params)) {
      if (v === undefined || v === null) continue;
      url.searchParams.append(k, String(v));
    }
  }
  const res = await fetch(url, {
    method,
    headers: {
      Authorization: authHeader(c),
      Accept: "application/json",
      ...(init.body !== undefined ? { "Content-Type": "application/json" } : {}),
    },
    body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
  });
  const text = await res.text();
  let json: unknown = text;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    // not JSON — keep as string
  }
  return { status: res.status, text, json };
}

/**
 * Ensures the active company for this user is `c.company`. Skipped if `c.company`
 * is falsy. Uses GetCompanyList (which lists *other* companies switchable to)
 * as the cheap detection signal.
 */
async function ensureCompany(c: MonetCreds): Promise<void> {
  if (!c.company) return;
  const list = await rawRequest(c, "GET", "/GetCompanyList", {
    params: { _page: 0, _size: 100 },
  });
  if (list.status >= 400) throw new MonetError(list.status, list.text);
  const switchable = Array.isArray(list.json) ? (list.json as Array<{ ID: string }>) : [];
  const needsSwitch = switchable.some((co) => co.ID === c.company);
  if (!needsSwitch) return;
  const r = await rawRequest(c, "PUT", "/SetCompany", {
    params: { _company: c.company },
  });
  if (r.status >= 400) {
    throw new MonetError(
      r.status,
      r.text,
      `SetCompany to '${c.company}' failed (HTTP ${r.status}). Verify the company ID is correct and the user has access.`,
    );
  }
}

export async function call<T = unknown>(
  c: MonetCreds,
  method: string,
  path: string,
  init: { params?: Record<string, string | number | boolean | undefined>; body?: unknown } = {},
): Promise<T> {
  await ensureCompany(c);
  const r = await rawRequest(c, method, path, init);
  if (r.status === 401 || r.status === 403) {
    throw new MonetError(r.status, r.text, `Auth failed (HTTP ${r.status}). Check x-monet-user / x-monet-pass headers.`);
  }
  if (r.status >= 400) {
    throw new MonetError(r.status, r.text);
  }
  return r.json as T;
}

/** Pulls credentials from MCP request headers. */
export function credsFromHeaders(headers: Headers): MonetCreds {
  const user = headers.get("x-monet-user") ?? headers.get("X-Monet-User") ?? "";
  const pass = headers.get("x-monet-pass") ?? headers.get("X-Monet-Pass") ?? "";
  const company =
    headers.get("x-monet-company") ?? headers.get("X-Monet-Company") ?? undefined;
  // Fallback: Authorization: Basic ...
  let finalUser = user;
  let finalPass = pass;
  if ((!finalUser || !finalPass) && headers.get("authorization")) {
    const m = headers.get("authorization")!.match(/^Basic\s+([A-Za-z0-9+/=]+)$/i);
    if (m) {
      try {
        const decoded = Buffer.from(m[1], "base64").toString("utf8");
        const idx = decoded.indexOf(":");
        if (idx > 0) {
          finalUser = finalUser || decoded.slice(0, idx);
          finalPass = finalPass || decoded.slice(idx + 1);
        }
      } catch {
        // ignore
      }
    }
  }
  if (!finalUser || !finalPass) {
    throw new Error(
      "Missing Monet credentials. Provide x-monet-user and x-monet-pass headers (or Authorization: Basic) in your MCP client config.",
    );
  }
  return {
    user: finalUser,
    pass: finalPass,
    company: company || undefined,
    baseUrl: DEFAULT_BASE_URL,
  };
}
