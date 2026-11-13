import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "STX Trace — OSINT Workbench",
  description:
    "Deep-search usernames, emails, phones and names across public sources. AI face verification (1:1) and synthesized intelligence reports. Public data only.",
};

export const viewport: Viewport = {
  themeColor: "#070a0d",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
