/**
 * MCP tool definitions for MonetAPI v2.
 *
 * Each tool: name, description (LT+EN), input schema (Zod), handler.
 * Handlers receive (args, headers) and call the Monet API.
 *
 * Coverage: Items, Inventory, Customers, Vendors, Sales, Purchases, Invoices,
 * Company / Settings, Payments, Employees. Effectively the full public API.
 */

import { z } from "zod";
import { call, callBinary, credsFromHeaders, MonetError } from "./monet";

/** Sentinel: when a tool handler returns this shape, the MCP route emits the
 *  content array verbatim instead of stringifying. Use for binary downloads. */
export const MCP_CONTENT = "__mcp_content__" as const;
export interface RawMcpContent {
  [MCP_CONTENT]: true;
  content: unknown[];
}

type Headers_ = Headers;

interface ToolCtx {
  headers: Headers_;
}

export interface ToolDef {
  name: string;
  description: string;
  schema: z.ZodTypeAny;
  handler: (args: any, ctx: ToolCtx) => Promise<unknown>;
}

const formatError = (e: unknown): string => {
  if (e instanceof MonetError) {
    return `Monet API error ${e.status}: ${e.bodyText.slice(0, 500)}`;
  }
  return e instanceof Error ? e.message : String(e);
};

const wrap = (
  fn: (args: any, ctx: ToolCtx) => Promise<unknown>,
): ToolDef["handler"] =>
  async (args, ctx) => {
    try {
      return await fn(args, ctx);
    } catch (e) {
      return { error: formatError(e) };
    }
  };

// Common reusable schemas

const lineSchema = z
  .object({
    ItemId: z.string().describe("Prekės kodas / Item code"),
    Name: z.string().optional(),
    Qty: z.number().describe("Kiekis / Quantity"),
    LinePercent: z.number().optional().describe("Nuolaidos % / Discount %"),
    Price: z.number().optional(),
    Amount: z.number().optional(),
    CostPrice: z.number().optional(),
    Location: z.string().optional().describe("Sandėlis / Warehouse"),
    TaxItemGroup: z
      .string()
      .optional()
      .describe("PVM grupė: PVM_0, PVM_5, PVM_9, PVM_12, PVM_21, PVM_100, PVM_21_SAVO"),
    Notes: z.string().optional(),
  })
  .passthrough();

const dimSchema = z
  .tuple([z.string(), z.string(), z.string()])
  .describe("[Padalinys, Projektas, Produktas] / [Dept, Project, Product]");

// ---------- ITEMS ----------

const ITEM_TOOLS: ToolDef[] = [
  {
    name: "get_item",
    description:
      "Grąžina prekės objektą su likučiais. / Get a single item with stock balances.",
    schema: z.object({
      itemId: z.string(),
      showZero: z.boolean().optional().default(false),
    }),
    handler: wrap(async ({ itemId, showZero }, { headers }) =>
      call(credsFromHeaders(headers), "GET", "/GetItem", {
        params: { itemId, _showZero: showZero ? "true" : "false" },
      }),
    ),
  },
  {
    name: "get_item_list",
    description:
      "Grąžina prekių sąrašą. / List items. Supports search & pagination.",
    schema: z.object({
      search: z.string().optional(),
      page: z.number().int().optional().default(0),
      size: z.number().int().optional().default(50),
    }),
    handler: wrap(async ({ search, page, size }, { headers }) =>
      call(credsFromHeaders(headers), "GET", "/GetItemList", {
        params: { _search: search, _page: page, _size: size },
      }),
    ),
  },
  {
    name: "items_quantity",
    description:
      "Prekių likučiai sandėliuose. / Item stock quantities. all=true grąžina ir nulinius likučius.",
    schema: z.object({
      all: z.boolean().optional().default(false),
      showZero: z.boolean().optional().default(false),
      page: z.number().int().optional().default(0),
      size: z.number().int().optional().default(30),
    }),
    handler: wrap(async ({ all, showZero, page, size }, { headers }) =>
      call(credsFromHeaders(headers), "GET", "/ItemsQuantity", {
        params: { _all: all, _showZero: showZero, _page: page, _size: size },
      }),
    ),
  },
  {
    name: "insert_item",
    description:
      "Sukurti naują prekę. Required: ItemId, Name. Optional: Type, Group, Price, Currency, TaxItemGroup, Description, Unit. / Create a new item.",
    schema: z
      .object({
        ItemId: z.string(),
        Name: z.string(),
      })
      .passthrough(),
    handler: wrap(async (body, { headers }) =>
      call(credsFromHeaders(headers), "POST", "/InsertItem", { body }),
    ),
  },
  {
    name: "update_item",
    description: "Atnaujinti prekę. Required: ItemId. / Update an item.",
    schema: z.object({ ItemId: z.string() }).passthrough(),
    handler: wrap(async (body, { headers }) =>
      call(credsFromHeaders(headers), "PUT", "/UpdateItem", { body }),
    ),
  },
  {
    name: "delete_item",
    description: "Ištrinti prekę pagal ID. / Delete an item by ID.",
    schema: z.object({ itemId: z.string() }),
    handler: wrap(async ({ itemId }, { headers }) =>
      call(credsFromHeaders(headers), "DELETE", "/DeleteItem", {
        params: { _id: itemId },
      }),
    ),
  },
];

// ---------- INVENTORY ----------

const INVENTORY_TOOLS: ToolDef[] = [
  {
    name: "create_invent_journal",
    description:
      "Sukuria sandėlio žurnalą. type: 0 = nurašymas, 2 = perkėlimas. Grąžina sukurto žurnalo numerį (pvz. IZ-000485). / Create an inventory journal. Returns the new journal ID.",
    schema: z.object({
      type: z.number().int().describe("0 = nurašymas/scrap, 2 = perkėlimas/transfer"),
      name: z.string().optional().describe("Aprašymas"),
    }),
    handler: wrap(async ({ type, name }, { headers }) =>
      call(credsFromHeaders(headers), "POST", "/CreateInventJournal", {
        params: { type, name },
      }),
    ),
  },
  {
    name: "create_invent_journal_line_acquisition_scrap",
    description:
      "Pridėti įsigijimo / nurašymo eilutę į žurnalą. Body laukai: Date (Req), ItemId (Req), Location (Req, '' jei nepriskirtas), Qty, Amount (pajamavimo suma), LedgerAccount (Req DK sąskaita), Dim ([Padalinys, Projektas, Produktas]). / Add an acquisition / scrap line.",
    schema: z
      .object({
        journalId: z.string(),
        Date: z.string(),
        ItemId: z.string(),
        Location: z.string(),
        LedgerAccount: z.string(),
      })
      .passthrough(),
    handler: wrap(async ({ journalId, ...body }, { headers }) =>
      call(credsFromHeaders(headers), "POST", "/CreateInventJournalLine", {
        params: { journalId },
        body,
      }),
    ),
  },
  {
    name: "create_invent_journal_line_transfer",
    description:
      "Pridėti perkėlimo eilutę į žurnalą. Body laukai: Date, ItemId, Location, Qty, ToLocation (Req — sandėlis į kurį perkeliama), Dim. / Add a transfer line.",
    schema: z
      .object({
        journalId: z.string(),
        Date: z.string(),
        ItemId: z.string(),
        Location: z.string(),
        ToLocation: z.string(),
      })
      .passthrough(),
    handler: wrap(async ({ journalId, ...body }, { headers }) =>
      call(credsFromHeaders(headers), "POST", "/CreateInventJournalLine", {
        params: { journalId },
        body,
      }),
    ),
  },
  {
    name: "create_invent_journal_line_bom",
    description:
      "Pridėti komplekto (BOM) eilutę. Teigiamas Qty = gaminys, neigiamas = naudojama prekė. Body laukai: Date, ItemId, Location, Qty (Req), Dim. Komplektas iš 2 prekių reikalauja 3 eilučių. / Add a bill-of-materials line.",
    schema: z
      .object({
        journalId: z.string(),
        Date: z.string(),
        ItemId: z.string(),
        Location: z.string(),
        Qty: z.number(),
      })
      .passthrough(),
    handler: wrap(async ({ journalId, ...body }, { headers }) =>
      call(credsFromHeaders(headers), "POST", "/CreateInventJournalLine", {
        params: { journalId },
        body,
      }),
    ),
  },
  {
    name: "check_invent_journal",
    description:
      "Patikrina ar žurnalas užregistruotas. Grąžina 0 (neregistruotas) arba 1 (registruotas). / Check journal posted state.",
    schema: z.object({ journalId: z.string() }),
    handler: wrap(async ({ journalId }, { headers }) =>
      call(credsFromHeaders(headers), "GET", "/CheckInventJournal", {
        params: { journalId },
      }),
    ),
  },
  {
    name: "post_invent_journal",
    description: "Užregistruoja sandėlio žurnalą. / Post an inventory journal.",
    schema: z.object({ journalId: z.string() }),
    handler: wrap(async ({ journalId }, { headers }) =>
      call(credsFromHeaders(headers), "PUT", "/PostInventJournal", {
        params: { journalId },
      }),
    ),
  },
];

// ---------- CUSTOMERS ----------

const CUST_TOOLS: ToolDef[] = [
  {
    name: "get_customer_list",
    description:
      "Klientų sąrašas. Palaiko paiešką ir puslapiavimą. / List customers (search + pagination).",
    schema: z.object({
      search: z.string().optional(),
      page: z.number().int().optional().default(0),
      size: z.number().int().optional().default(50),
    }),
    handler: wrap(async ({ search, page, size }, { headers }) =>
      call(credsFromHeaders(headers), "GET", "/GetCustList", {
        params: { _search: search, _page: page, _size: size },
      }),
    ),
  },
  {
    name: "insert_customer",
    description:
      "Sukurti naują klientą. Required: CustomerId (trumpinys), Name. Common optional: EnterpriseCode, VATNum, Email, Phone, Address, City, ZipCode, Country (Alpha-2), Currency, PaymTerm, GroupId, LanguageId. / Create a customer.",
    schema: z
      .object({
        CustomerId: z.string(),
        Name: z.string(),
      })
      .passthrough(),
    handler: wrap(async (body, { headers }) =>
      call(credsFromHeaders(headers), "POST", "/InsertCust", { body }),
    ),
  },
  {
    name: "update_customer",
    description:
      "Atnaujinti klientą. Required: CustomerId. / Update a customer.",
    schema: z.object({ CustomerId: z.string() }).passthrough(),
    handler: wrap(async (body, { headers }) =>
      call(credsFromHeaders(headers), "PUT", "/UpdateCust", { body }),
    ),
  },
  {
    name: "delete_customer",
    description: "Ištrinti klientą pagal ID. / Delete a customer by ID.",
    schema: z.object({ customerId: z.string() }),
    handler: wrap(async ({ customerId }, { headers }) =>
      call(credsFromHeaders(headers), "DELETE", "/DeleteCust", {
        params: { _id: customerId },
      }),
    ),
  },
];

// ---------- VENDORS ----------

const VEND_TOOLS: ToolDef[] = [
  {
    name: "get_vendor_list",
    description:
      "Tiekėjų sąrašas. / List vendors (search + pagination).",
    schema: z.object({
      search: z.string().optional(),
      page: z.number().int().optional().default(0),
      size: z.number().int().optional().default(50),
    }),
    handler: wrap(async ({ search, page, size }, { headers }) =>
      call(credsFromHeaders(headers), "GET", "/GetVendList", {
        params: { _search: search, _page: page, _size: size },
      }),
    ),
  },
  {
    name: "insert_vendor",
    description:
      "Sukurti naują tiekėją. Required: VendorId, Name. / Create a vendor.",
    schema: z.object({ VendorId: z.string(), Name: z.string() }).passthrough(),
    handler: wrap(async (body, { headers }) =>
      call(credsFromHeaders(headers), "POST", "/InsertVend", { body }),
    ),
  },
  {
    name: "update_vendor",
    description:
      "Atnaujinti tiekėją. Required: VendorId. / Update a vendor.",
    schema: z.object({ VendorId: z.string() }).passthrough(),
    handler: wrap(async (body, { headers }) =>
      call(credsFromHeaders(headers), "PUT", "/UpdateVend", { body }),
    ),
  },
  {
    name: "delete_vendor",
    description: "Ištrinti tiekėją pagal ID. / Delete a vendor by ID.",
    schema: z.object({ vendorId: z.string() }),
    handler: wrap(async ({ vendorId }, { headers }) =>
      call(credsFromHeaders(headers), "DELETE", "/DeleteVend", {
        params: { _id: vendorId },
      }),
    ),
  },
];

// ---------- SALES (and contracts) ----------

const SALES_TOOLS: ToolDef[] = [
  {
    name: "get_sales_sched_list",
    description:
      "Pardavimo sutarčių (grafikų) sąrašas. / List sales contract schedules.",
    schema: z.object({}),
    handler: wrap(async (_args, { headers }) =>
      call(credsFromHeaders(headers), "GET", "/GetSalesSchedList"),
    ),
  },
  {
    name: "post_sales_sched",
    description:
      "Sukurti pardavimo sutartį (grafiką). Required: CustomerId, plus contract fields. / Create a sales schedule.",
    schema: z.object({ CustomerId: z.string() }).passthrough(),
    handler: wrap(async (body, { headers }) =>
      call(credsFromHeaders(headers), "POST", "/PostSalesSched", { body }),
    ),
  },
  {
    name: "post_sales",
    description:
      "Sukurti pardavimo sąskaitą (Prekių pardavimas). Required: CustomerId, SalesOrderLines[]. Optional: InvoiceId, Date, DueDate, CurrencyCode, PaymentMode, Notes, FullAmount, FullTax, InclTax, SalesType (1=Pasiulymas, 3=Uzsakymas, 4=Grazinta), DocumentNum, TransactionCode, Transport, DeliveryCountry (Alpha-2), Dim ([Dept, Project, Product]), SkipPost. / Create a sales (goods) invoice.",
    schema: z
      .object({
        CustomerId: z.string(),
        SalesOrderLines: z.array(lineSchema).min(1),
      })
      .passthrough(),
    handler: wrap(async (body, { headers }) =>
      call(credsFromHeaders(headers), "POST", "/PostSales", { body }),
    ),
  },
  {
    name: "post_sales_service",
    description:
      "Sukurti paslaugų pardavimo sąskaitą. Required: CustomerId, SalesOrderLines[]. / Create a services sales invoice.",
    schema: z
      .object({
        CustomerId: z.string(),
        SalesOrderLines: z.array(lineSchema).min(1),
      })
      .passthrough(),
    handler: wrap(async (body, { headers }) =>
      call(credsFromHeaders(headers), "POST", "/PostSalesService", { body }),
    ),
  },
  {
    name: "post_sales_refund",
    description:
      "Pardavimo grąžinimas pagal SF nr. invoiceId — grąžinamos SF numeris. Body privalo CustomerId + SalesOrderLines[]. SalesType=4 (Grąžinta prekė) automatinis. / Issue a sales refund.",
    schema: z
      .object({
        invoiceId: z.string().describe("Original invoice number being refunded"),
        CustomerId: z.string(),
        SalesOrderLines: z.array(lineSchema).min(1),
      })
      .passthrough(),
    handler: wrap(async ({ invoiceId, ...body }, { headers }) =>
      call(credsFromHeaders(headers), "POST", "/PostSalesRefunds", {
        params: { invoiceId },
        body,
      }),
    ),
  },
];

// ---------- PURCHASES ----------

const PURCH_TOOLS: ToolDef[] = [
  {
    name: "post_purch",
    description:
      "Užregistruoti prekių pirkimo sąskaitą. Required: VendorId, PurchOrderLines[]. Optional: InvoiceId, Date, DueDate, InclTax, Notes, FullAmount, FullTax, TransactionCode, Transport, SkipPost, Dim, MarkupAllocation (0=Grynoji, 1=Kiekis, 2=Eilutės), MarkupTransLines[]. / Register a purchase (goods) invoice.",
    schema: z
      .object({
        VendorId: z.string(),
        PurchOrderLines: z.array(lineSchema).min(1),
      })
      .passthrough(),
    handler: wrap(async (body, { headers }) =>
      call(credsFromHeaders(headers), "POST", "/PostPurch", { body }),
    ),
  },
  {
    name: "post_purch_service",
    description:
      "Užregistruoti paslaugų pirkimo sąskaitą. / Register a services purchase invoice.",
    schema: z.object({ VendorId: z.string() }).passthrough(),
    handler: wrap(async (body, { headers }) =>
      call(credsFromHeaders(headers), "PUT", "/PostPurchService", { body }),
    ),
  },
];

// ---------- INVOICES (read) ----------

const INVOICE_TOOLS: ToolDef[] = [
  {
    name: "get_cust_invoice_list",
    description:
      "Pardavimų SF sąrašas. Palaiko paiešką pagal SF nr. arba kliento pavadinimą + puslapiavimą. / List sales invoices (search by invoice number or customer name).",
    schema: z.object({
      search: z.string().optional(),
      page: z.number().int().optional().default(0),
      size: z.number().int().optional().default(100),
    }),
    handler: wrap(async ({ search, page, size }, { headers }) =>
      call(credsFromHeaders(headers), "GET", "/GetCustInvoiceList", {
        params: { _search: search, _page: page, _size: size },
      }),
    ),
  },
  {
    name: "get_vend_invoice_list",
    description:
      "Pirkimų SF sąrašas. / List vendor (purchase) invoices.",
    schema: z.object({
      search: z.string().optional(),
      page: z.number().int().optional().default(0),
      size: z.number().int().optional().default(100),
    }),
    handler: wrap(async ({ search, page, size }, { headers }) =>
      call(credsFromHeaders(headers), "GET", "/GetVendInvoiceList", {
        params: { _search: search, _page: page, _size: size },
      }),
    ),
  },
  {
    name: "get_sales_invoice_pdf",
    description:
      "Atsisiųsti pardavimo SF kaip PDF. Grąžina base64-encoded PDF + filename + dydį. MCP klientai (Claude Desktop, Cursor) gali parodyti / išsaugoti failą tiesiogiai. / Download a sales invoice as PDF.",
    schema: z.object({ invoiceId: z.string() }),
    handler: async ({ invoiceId }, { headers }) => {
      try {
        const r = await callBinary(
          credsFromHeaders(headers),
          "PUT",
          "/GetSalesInvoice",
          { params: { invoiceId } },
        );
        const filename = r.filename ?? `${invoiceId}.pdf`;
        return {
          [MCP_CONTENT]: true,
          content: [
            {
              type: "text",
              text: `Downloaded ${filename} — ${r.contentType}, ${r.sizeBytes} bytes`,
            },
            {
              type: "resource",
              resource: {
                uri: `monet://invoice/${encodeURIComponent(filename)}`,
                mimeType: r.contentType,
                blob: r.base64,
              },
            },
          ],
        } as RawMcpContent;
      } catch (e) {
        return {
          error:
            e instanceof MonetError
              ? `Monet API error ${e.status}: ${e.bodyText.slice(0, 500)}`
              : e instanceof Error
                ? e.message
                : String(e),
        };
      }
    },
  },
  {
    name: "get_cust_invoice_balance",
    description:
      "Konkrečios kliento SF likutis valiuta. Reikalauja kliento ID + SF nr. / Customer invoice balance.",
    schema: z.object({
      accountNum: z.string().describe("Customer ID"),
      invoiceId: z.string(),
    }),
    handler: wrap(async ({ accountNum, invoiceId }, { headers }) =>
      call(credsFromHeaders(headers), "GET", "/GetCustInvoiceBalanceCur", {
        params: { _accountNum: accountNum, _invoiceId: invoiceId },
      }),
    ),
  },
  {
    name: "get_vend_invoice_balance",
    description:
      "Konkrečios tiekėjo SF likutis valiuta. Reikalauja tiekėjo ID + SF nr. / Vendor invoice balance.",
    schema: z.object({
      accountNum: z.string().describe("Vendor ID"),
      invoiceId: z.string(),
    }),
    handler: wrap(async ({ accountNum, invoiceId }, { headers }) =>
      call(credsFromHeaders(headers), "GET", "/GetVendInvoiceBalanceCur", {
        params: { _accountNum: accountNum, _invoiceId: invoiceId },
      }),
    ),
  },
];

// ---------- COMPANY / SETTINGS ----------

const COMPANY_TOOLS: ToolDef[] = [
  {
    name: "get_company_list",
    description:
      "Grąžina kitas (perjungiamas) įmones, jei vartotojas turi prieigą prie kelių. Aktyvi įmonė į sąrašą NEĮEINA. / List OTHER (switchable) companies. The active one is NOT in this list.",
    schema: z.object({
      search: z.string().optional(),
      page: z.number().int().optional().default(0),
      size: z.number().int().optional().default(30),
    }),
    handler: wrap(async ({ search, page, size }, { headers }) =>
      call(credsFromHeaders(headers), "GET", "/GetCompanyList", {
        params: { _search: search, _page: page, _size: size },
      }),
    ),
  },
  {
    name: "get_company",
    description:
      "Grąžina dabartinės aktyvios įmonės pavadinimą. / Returns the currently active company name.",
    schema: z.object({}),
    handler: wrap(async (_a, { headers }) =>
      call(credsFromHeaders(headers), "GET", "/GetCompany"),
    ),
  },
  {
    name: "set_company",
    description:
      "Pakeičia aktyvią įmonę pagal ID. PASTABA: pakeitimas yra persistent server-side. Jei naudoji Monet web UI, jis taip pat persijungs. / Switch the active company by ID. WARNING: persistent server-side. Will affect your Monet web UI session.",
    schema: z.object({ companyId: z.string() }),
    handler: wrap(async ({ companyId }, { headers }) =>
      call(credsFromHeaders(headers), "PUT", "/SetCompany", {
        params: { _company: companyId },
      }),
    ),
  },
  {
    name: "get_currency_codes",
    description: "Valiutų sąrašas. / Currency codes.",
    schema: z.object({}),
    handler: wrap(async (_a, { headers }) =>
      call(credsFromHeaders(headers), "GET", "/GetCurrencyCodeList"),
    ),
  },
  {
    name: "get_tax_item_groups",
    description:
      "PVM grupės (PVM_0, PVM_5, PVM_9, PVM_12, PVM_21, PVM_100, PVM_21_SAVO, ...). / VAT groups.",
    schema: z.object({}),
    handler: wrap(async (_a, { headers }) =>
      call(credsFromHeaders(headers), "GET", "/GetTaxItemGroupList"),
    ),
  },
  {
    name: "get_locations",
    description: "Sandėlių sąrašas. / Warehouse locations.",
    schema: z.object({}),
    handler: wrap(async (_a, { headers }) =>
      call(credsFromHeaders(headers), "GET", "/GetLocationList"),
    ),
  },
  {
    name: "get_item_groups",
    description: "Prekių grupės. / Item groups.",
    schema: z.object({}),
    handler: wrap(async (_a, { headers }) =>
      call(credsFromHeaders(headers), "GET", "/GetItemGroupList"),
    ),
  },
  {
    name: "get_item_types",
    description: "Prekių tipai. / Item types.",
    schema: z.object({}),
    handler: wrap(async (_a, { headers }) =>
      call(credsFromHeaders(headers), "GET", "/GetItemTypeList"),
    ),
  },
  {
    name: "get_ledger_list",
    description:
      "DK sąskaitų sąrašas. / Chart of accounts (general ledger).",
    schema: z.object({}),
    handler: wrap(async (_a, { headers }) =>
      call(credsFromHeaders(headers), "GET", "/GetLedgerList"),
    ),
  },
  {
    name: "get_dim_list",
    description:
      "Požymių (Dim) sąrašas. type: 0=Padalinys, 1=Projektas, 2=Produktas. / Dimensions list (departments / projects / products).",
    schema: z.object({
      type: z.number().int().min(0).max(2).default(0),
      search: z.string().optional(),
      page: z.number().int().optional().default(0),
      size: z.number().int().optional().default(30),
    }),
    handler: wrap(async ({ type, search, page, size }, { headers }) =>
      call(credsFromHeaders(headers), "GET", "/GetDimList", {
        params: { _type: type, _search: search, _page: page, _size: size },
      }),
    ),
  },
  {
    name: "insert_dim",
    description:
      "Sukurti naują požymį. Type: 0=Padalinys, 1=Projektas, 2=Produktas. Id ir Name privalomi. / Create a new dimension value.",
    schema: z
      .object({
        Type: z.number().int().min(0).max(2),
        Id: z.string(),
        Name: z.string(),
      })
      .passthrough(),
    handler: wrap(async (body, { headers }) =>
      call(credsFromHeaders(headers), "POST", "/InsertDim", { body }),
    ),
  },
  {
    name: "get_language",
    description: "Sistemos kalba. / Get UI language.",
    schema: z.object({}),
    handler: wrap(async (_a, { headers }) =>
      call(credsFromHeaders(headers), "GET", "/GetLanguage"),
    ),
  },
  {
    name: "set_language",
    description: "Pakeisti sistemos kalbą. / Set UI language.",
    schema: z.object({ language: z.string().describe("e.g. lt, en") }),
    handler: wrap(async ({ language }, { headers }) =>
      call(credsFromHeaders(headers), "PUT", "/SetLanguage", {
        params: { _language: language },
      }),
    ),
  },
];

// ---------- PAYMENTS / LEDGER ----------

const PAYMENT_TOOLS: ToolDef[] = [
  {
    name: "post_ledger_journal",
    description:
      "Užregistruoti mokėjimą / DK įrašą. Required: Currency, Account, AccountType (0=DK, 1=Klientas, 2=Tiekėjas, 5=Turtas, 6=Bankas), Date, AccountOffset, AccountTypeOffset. Optional: Debet, Credit, Txt, Profile, DocumentNum. / Post a payment / ledger journal entry.",
    schema: z
      .object({
        Currency: z.string(),
        Account: z.string(),
        AccountType: z.number().int(),
        Date: z.string(),
        AccountOffset: z.string(),
        AccountTypeOffset: z.number().int(),
      })
      .passthrough(),
    handler: wrap(async (body, { headers }) =>
      call(credsFromHeaders(headers), "PUT", "/PostLedgerJournal", { body }),
    ),
  },
  {
    name: "delete_trans",
    description:
      "Ištrinti DK operaciją pagal voucher numerį. / Delete a ledger transaction by voucher number.",
    schema: z.object({ voucher: z.string() }),
    handler: wrap(async ({ voucher }, { headers }) =>
      call(credsFromHeaders(headers), "DELETE", "/DeleteTrans", {
        params: { voucher },
      }),
    ),
  },
  {
    name: "get_cust_open_payments",
    description:
      "Konkretaus kliento neapmokėtos sąskaitos. accountNum yra kliento ID (CustomerId). / Open (unpaid) invoices for a specific customer.",
    schema: z.object({
      accountNum: z.string().describe("Customer ID (e.g. 'Aroja')"),
      page: z.number().int().optional().default(0),
      size: z.number().int().optional().default(300),
    }),
    handler: wrap(async ({ accountNum, page, size }, { headers }) =>
      call(credsFromHeaders(headers), "GET", "/GetCustOpenPayments", {
        params: { _accountNum: accountNum, _page: page, _size: size },
      }),
    ),
  },
  {
    name: "get_cust_balance",
    description:
      "Konkretaus kliento balansas. accountNum yra kliento ID. / Balance for a specific customer.",
    schema: z.object({ accountNum: z.string() }),
    handler: wrap(async ({ accountNum }, { headers }) =>
      call(credsFromHeaders(headers), "GET", "/GetCustBalance", {
        params: { _accountNum: accountNum },
      }),
    ),
  },
  {
    name: "get_vend_balance",
    description:
      "Konkretaus tiekėjo balansas. accountNum yra tiekėjo ID. / Balance for a specific vendor.",
    schema: z.object({ accountNum: z.string() }),
    handler: wrap(async ({ accountNum }, { headers }) =>
      call(credsFromHeaders(headers), "GET", "/GetVendBalance", {
        params: { _accountNum: accountNum },
      }),
    ),
  },
  {
    name: "get_vend_open_payments",
    description:
      "Konkretaus tiekėjo neapmokėtos sąskaitos. accountNum yra tiekėjo ID. / Open (unpaid) invoices for a specific vendor.",
    schema: z.object({
      accountNum: z.string(),
      page: z.number().int().optional().default(0),
      size: z.number().int().optional().default(300),
    }),
    handler: wrap(async ({ accountNum, page, size }, { headers }) =>
      call(credsFromHeaders(headers), "GET", "/GetVendOpenPayments", {
        params: { _accountNum: accountNum, _page: page, _size: size },
      }),
    ),
  },
];

// ---------- EMPLOYEES ----------

const EMPLOYEE_TOOLS: ToolDef[] = [
  {
    name: "get_company_worker_timetable",
    description:
      "Darbo laiko apskaita (tabelis) konkrečiai įmonei. companyCode = įmonės kodas (pvz. '301844037'). agreementId = vienas arba keli sutarties ID, atskirti kableliais (pvz. 'D_004,D_005'). / Employee timetable.",
    schema: z.object({
      companyCode: z.string().describe("Company registration code"),
      agreementId: z.string().describe("Agreement ID(s), comma-separated"),
      dateFrom: z.string().describe("YYYY-MM-DD"),
      dateTo: z.string().describe("YYYY-MM-DD"),
    }),
    handler: wrap(async ({ companyCode, agreementId, dateFrom, dateTo }, { headers }) =>
      call(credsFromHeaders(headers), "GET", "/GetCompanyWorkerTimeTable", {
        params: {
          _companyCode: companyCode,
          _agreementId: agreementId,
          _dateFrom: dateFrom,
          _dateTo: dateTo,
        },
      }),
    ),
  },
];

// ---------- PROBE / META ----------

const META_TOOLS: ToolDef[] = [
  {
    name: "monet_probe",
    description:
      "Greita patikra: ar credentials veikia ir kuri įmonė šiuo metu aktyvi vartotojui. Naudinga setup'o derinimui. / Quick probe: validates credentials and reports which company is active.",
    schema: z.object({}),
    handler: wrap(async (_a, { headers }) => {
      const c = credsFromHeaders(headers);
      const company = await call(c, "GET", "/GetCompany");
      const switchable = await call(c, "GET", "/GetCompanyList", {
        params: { _page: 0, _size: 100 },
      });
      return {
        ok: true,
        active_company: company,
        switchable_companies: switchable,
        target_company_header: c.company ?? null,
        note: "If x-monet-company is set, every tool call switches to it before executing.",
      };
    }),
  },
];

// ---------- AGGREGATE ----------

export const ALL_TOOLS: ToolDef[] = [
  ...META_TOOLS,
  ...ITEM_TOOLS,
  ...INVENTORY_TOOLS,
  ...CUST_TOOLS,
  ...VEND_TOOLS,
  ...SALES_TOOLS,
  ...PURCH_TOOLS,
  ...INVOICE_TOOLS,
  ...COMPANY_TOOLS,
  ...PAYMENT_TOOLS,
  ...EMPLOYEE_TOOLS,
];

// suppress unused warning for shared exports if any
export { dimSchema, lineSchema };
