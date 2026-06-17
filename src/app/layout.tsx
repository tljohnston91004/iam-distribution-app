import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "IAM — Inventory Action Manager (Distribution)",
  description:
    "Identify what inventory action matters most now, assign ownership, track holdovers, and confirm results.",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
