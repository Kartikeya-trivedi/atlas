import type { Metadata, Viewport } from "next";
import { Instrument_Sans, JetBrains_Mono } from "next/font/google";
import { AppShell } from "@/components/AppShell";
import "./globals.css";

/**
 * Instrument Sans for the interface, JetBrains Mono for anything numeric.
 *
 * The split is not decorative. This is a retrieval console: scores, ranks,
 * latencies and identifiers sit in columns that have to be scannable, and
 * proportional digits in a score column make the eye re-find the decimal point
 * on every row.
 */
const sans = Instrument_Sans({
  subsets: ["latin"],
  variable: "--font-instrument",
  display: "swap",
});

const mono = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-jetbrains",
  display: "swap",
  weight: ["400", "500"],
});

export const metadata: Metadata = {
  title: "Atlas",
  description:
    "Permission-aware hybrid retrieval. Dense and lexical channels, fused, with every ranking decision inspectable.",
};

export const viewport: Viewport = {
  themeColor: "#07080a",
  colorScheme: "dark",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={`${sans.variable} ${mono.variable}`}>
      <body>
        <AppShell>{children}</AppShell>
      </body>
    </html>
  );
}
