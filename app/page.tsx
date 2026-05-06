export default function Page() {
  return (
    <main>
      <h1 style={{ margin: 0 }}>Monet MCP</h1>
      <p>
        Multi-tenant Model Context Protocol server for{" "}
        <a href="https://e.monet.lt">MonetAPI v2</a> (Lithuanian bookkeeping).
        Each user supplies their own Monet credentials via MCP client headers —
        the server is stateless and forwards requests on behalf of the caller.
      </p>

      <h2>Endpoint</h2>
      <pre style={pre}>POST /api/mcp</pre>
      <p>
        The server speaks the MCP <strong>Streamable HTTP</strong> transport.
        Most modern MCP clients (Claude Desktop, VS Code, Cursor, Windsurf,
        Continue) support it directly.
      </p>

      <h2>Required headers</h2>
      <ul>
        <li>
          <code>x-monet-user</code> — your Monet username
        </li>
        <li>
          <code>x-monet-pass</code> — your Monet password
        </li>
        <li>
          <code>x-monet-company</code> — Monet company ID (optional but
          recommended). Use <code>monet_probe</code> to discover it.
        </li>
      </ul>
      <p>
        Alternatively, send <code>Authorization: Basic …</code> with{" "}
        <code>user:pass</code> base64-encoded.
      </p>

      <h2>VS Code / Cursor / Claude Desktop config example</h2>
      <pre style={pre}>{`{
  "mcpServers": {
    "monet": {
      "url": "https://YOUR-DEPLOYMENT.vercel.app/api/mcp",
      "headers": {
        "x-monet-user": "marius",
        "x-monet-pass": "...",
        "x-monet-company": "2ZW"
      }
    }
  }
}`}</pre>

      <h2>Tool coverage</h2>
      <p>
        ~45 tools covering items, inventory journals, customers, vendors, sales
        (goods/services/refunds/contracts), purchases (goods/services), invoice
        reads &amp; balances, company / settings (companies, currencies, VAT
        groups, locations, ledgers, dimensions), payments (PostLedgerJournal,
        DeleteTrans, balances, open payments), and employee timetables. Run{" "}
        <code>monet_probe</code> first to verify the connection.
      </p>

      <h2>Source</h2>
      <p>
        See <code>README.md</code> for the full setup and tool list.
      </p>
    </main>
  );
}

const pre: React.CSSProperties = {
  background: "#f4f4f4",
  border: "1px solid #ddd",
  padding: 12,
  borderRadius: 6,
  overflowX: "auto",
  fontSize: 13,
};
