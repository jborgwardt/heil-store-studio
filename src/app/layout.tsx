import type { Metadata } from "next";
import { Geist } from "next/font/google";
import { Shell } from "@/components/shell";
import "./globals.css";

const sans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "HeilSS",
  description: "Build and manage an umbrelOS community app store.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={`dark ${sans.variable}`}>
      <body className="min-h-screen bg-[#07080d] font-sans text-white antialiased">
        <Shell>{children}</Shell>
      </body>
    </html>
  );
}
