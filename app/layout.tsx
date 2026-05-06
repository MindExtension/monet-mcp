export const metadata = {
  title: "Monet MCP",
  description:
    "Multi-tenant MCP server for MonetAPI v2 (Lithuanian bookkeeping).",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body
        style={{
          fontFamily:
            "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif",
          maxWidth: 760,
          margin: "40px auto",
          padding: "0 20px",
          color: "#222",
          lineHeight: 1.55,
        }}
      >
        {children}
      </body>
    </html>
  );
}
