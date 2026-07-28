import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "../index.css";
import { BloombergHeader } from "@/components/bloomberg-header";
import Providers from "@/components/providers";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "WIF + DOT Strategy Terminal",
  description:
    "Операционный терминал Consensus WIF + DOT Risk Accelerator для Binance USD-M",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ru" suppressHydrationWarning>
      <body
        className={`${geistSans.variable} ${geistMono.variable} min-h-svh antialiased`}
      >
        <Providers>
          <div className="min-h-svh bg-[radial-gradient(circle_at_top_right,oklch(0.21_0.05_160_/_0.28),transparent_38%),radial-gradient(circle_at_bottom_left,oklch(0.2_0.05_250_/_0.22),transparent_36%)]">
            <BloombergHeader />
            <main className="mx-auto w-full max-w-[1680px]">{children}</main>
          </div>
        </Providers>
      </body>
    </html>
  );
}
