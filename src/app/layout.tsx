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
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=IBM+Plex+Sans:wght@400;500;600;700&display=swap"
          rel="stylesheet"
        />
      </head>
      <body>{children}</body>
    </html>
  );
}
