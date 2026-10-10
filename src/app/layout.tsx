import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import "./globals.css";

export const metadata: Metadata = {
  title: "Kanakku: find hospital bill charges worth questioning",
  description: "Check an itemised Indian hospital bill against its own arithmetic, medicine price limits and the discharge summary, with evidence for every finding.",
};

export const viewport: Viewport = { themeColor: "#f6f4ef" };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en-IN">
      <body className="min-h-screen bg-paper font-sans text-ink antialiased print:bg-white">{children}</body>
    </html>
  );
}
