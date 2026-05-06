# Monet MCP

Multi-tenant **Model Context Protocol** server for **MonetAPI v2** (Lithuanian bookkeeping at `https://e.monet.lt`). Anyone can deploy a single instance to Vercel; users connect their MCP client (Claude Desktop, VS Code, Cursor, Windsurf, Continue, …) using their **own** Monet credentials passed via headers. The server is stateless and forwards requests on behalf of the caller.

## What you get

- **One Vercel deployment, many users.** No DB, no signup, no credential storage.
- **Industry-standard MCP HTTP transport** (`mcp-handler` / `@modelcontextprotocol/sdk`). Supports the Streamable HTTP transport spec, which all current MCP clients understand.
- **~45 tools** covering effectively the full Monet API: items, inventory journals, customers, vendors, sales (goods / services / refunds / contracts), purchases (goods / services), invoice reads & balances, company switching, currencies / VAT / dimensions / ledger, payments (PostLedgerJournal, DeleteTrans), balances & open payments, employee timetables.
- **Multi-company aware.** A single Monet user can have access to multiple companies (e.g. "MB Šilenskių biuras" + "UAB Saakuru technologijos"). Pass the company ID per request via `x-monet-company` and the server switches transparently.

## Deploy

### One-click

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https://github.com/YOUR_USER/monet-mcp)

### Manual

```bash
git clone https://github.com/YOUR_USER/monet-mcp
cd monet-mcp
pnpm install        # or npm / yarn
vercel              # link to a new Vercel project
vercel --prod
```

No env vars are required. Optionally set `MONET_BASE_URL` if you point at a non-default Monet instance.

## Connect from your MCP client

After deployment, your endpoint is:

```
https://<your-project>.vercel.app/api/mcp
```

Add it to your MCP client with **your own** Monet credentials in the headers.

### VS Code (`.vscode/mcp.json` or User Settings)

```json
{
  "servers": {
    "monet": {
      "type": "http",
      "url": "https://<your-project>.vercel.app/api/mcp",
      "headers": {
        "x-monet-user": "your-monet-username",
        "x-monet-pass": "your-monet-password",
        "x-monet-company": "2ZW"
      }
    }
  }
}
```

### Cursor (`~/.cursor/mcp.json`)

```json
{
  "mcpServers": {
    "monet": {
      "url": "https://<your-project>.vercel.app/api/mcp",
      "headers": {
        "x-monet-user": "your-monet-username",
        "x-monet-pass": "your-monet-password",
        "x-monet-company": "2ZW"
      }
    }
  }
}
```

### Claude Desktop (`~/Library/Application Support/Claude/claude_desktop_config.json` on macOS)

Claude Desktop's stdio integration expects a local process. To use a remote HTTP MCP, run a tiny local proxy via `mcp-remote`:

```json
{
  "mcpServers": {
    "monet": {
      "command": "npx",
      "args": [
        "mcp-remote",
        "https://<your-project>.vercel.app/api/mcp",
        "--header", "x-monet-user:your-monet-username",
        "--header", "x-monet-pass:your-monet-password",
        "--header", "x-monet-company:2ZW"
      ]
    }
  }
}
```

### Continue / Windsurf / any other MCP client

If the client supports HTTP MCP servers + custom headers, configure the URL and three headers above. If it only supports stdio, use the `mcp-remote` proxy approach shown for Claude Desktop.

## Finding your company ID

A single Monet user can be linked to multiple companies. Run the `monet_probe` tool first; it reports the active company name and the IDs of any other companies you can switch to. Use that ID as `x-monet-company`.

You can also call `get_company_list` (returns OTHER companies — the active one is NOT in the list) and `get_company` (returns the active company's name).

## Tool catalogue

### Items
`get_item`, `get_item_list`, `items_quantity`, `insert_item`, `update_item`, `delete_item`

### Inventory journals
`create_invent_journal`, `create_invent_journal_line_acquisition_scrap`, `create_invent_journal_line_transfer`, `create_invent_journal_line_bom`, `check_invent_journal`, `post_invent_journal`

### Customers
`get_customer_list`, `insert_customer`, `update_customer`, `delete_customer`

### Vendors
`get_vendor_list`, `insert_vendor`, `update_vendor`, `delete_vendor`

### Sales
`get_sales_sched_list`, `post_sales_sched`, `post_sales`, `post_sales_service`, `post_sales_refund`

### Purchases
`post_purch`, `post_purch_service`

### Invoices (read)
`get_cust_invoice_list`, `get_vend_invoice_list`, `get_sales_invoice_pdf`, `get_cust_invoice_balance`, `get_vend_invoice_balance`

### Company / Settings
`get_company_list`, `get_company`, `set_company`, `get_currency_codes`, `get_tax_item_groups`, `get_locations`, `get_item_groups`, `get_item_types`, `get_ledger_list`, `get_dim_list`, `insert_dim`, `get_language`, `set_language`

### Payments / Ledger
`post_ledger_journal`, `delete_trans`, `get_cust_open_payments`, `get_cust_balance`, `get_vend_balance`, `get_vend_open_payments`

### Employees
`get_company_worker_timetable`

### Meta
`monet_probe`

## Common Lithuanian reference values

- VAT groups: `PVM_0`, `PVM_5`, `PVM_9`, `PVM_12`, `PVM_21`, `PVM_100` (Kiti atvejai), `PVM_21_SAVO`
- AccountType (PostLedgerJournal): `0` = DK, `1` = Klientas, `2` = Tiekėjas, `5` = Turtas, `6` = Bankas
- SalesType (PostSales): `1` = Pasiūlymas, `3` = Pardavimo užsakymas, `4` = Grąžinta prekė
- MarkupAllocation (PostPurch): `0` = Grynoji suma, `1` = Kiekis, `2` = Pagal eilutes
- Country / DeliveryCountry: ISO Alpha-2 (`LT`, `GB`, `DE`, …)

## Important caveats

- **`set_company` is persistent server-side.** When the server switches the active company on your behalf for a tool call, it does **not** restore the previous one (each tool call is stateless). If you also use the Monet web UI under the same login, your view will follow whichever company was last targeted. Pin one `x-monet-company` per MCP client config to avoid surprises.
- **Rate limit.** Monet enforces ~1000 requests/hour per user. The server doesn't rate-limit you locally — your MCP client is responsible for sane usage.
- **Write operations are not gated by the server.** This is an MCP server; the LLM client is expected to confirm with the user before issuing writes. If you want hard local gating, run the [`monet-bookkeeping` Claude Code skill](https://github.com/YOUR_USER/monet-bookkeeping-skill) instead, which adds `--confirm` and `--i-understand-this-deletes` barriers at the CLI level.
- **No audit log.** Vercel functions are stateless; persistent audit logging would require an external store (Supabase, Postgres, R2). Add it if you need one.

## Local development

```bash
pnpm install
pnpm dev
# Server now at http://localhost:3000/api/mcp
```

Test with [`mcp-inspector`](https://github.com/modelcontextprotocol/inspector):

```bash
npx @modelcontextprotocol/inspector \
  --transport http \
  --url http://localhost:3000/api/mcp \
  --header "x-monet-user:demo" \
  --header "x-monet-pass:demo321demo321"
```

## Project layout

```
monet-mcp/
├── app/
│   ├── api/[transport]/route.ts   # MCP handler (Vercel serverless function)
│   ├── layout.tsx
│   └── page.tsx                   # Landing page with config snippets
├── src/
│   ├── monet.ts                   # Monet API client (auth, company switch, fetch)
│   └── tools.ts                   # All MCP tool definitions (~45)
├── package.json
├── tsconfig.json
├── next.config.js
├── vercel.json
└── README.md
```

## License

MIT (see `LICENSE`).
