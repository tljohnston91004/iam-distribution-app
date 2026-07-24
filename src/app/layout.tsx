import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "IAM V1.5 — Inventory Action Manager (Decision Priority)",
  description:
    "Weekly Decision Board for Active Priorities, OEC capacity, Waiting, WIP, and Deferred recommendations.",
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
