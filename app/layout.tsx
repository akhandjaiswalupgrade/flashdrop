import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "My Flash Drop",
  description: "A hardened temporary file drop with 1-hour expiry."
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
