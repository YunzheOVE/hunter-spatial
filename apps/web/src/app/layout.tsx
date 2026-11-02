import type { Metadata } from "next";
import type { ReactNode } from "react";
import { Inter } from "next/font/google";
import "./globals.css";
import "pannellum/build/pannellum.css";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter" });

export const metadata: Metadata = {
  title: "Hunter Spatial",
  description: "Indoor campus navigator for CUNY Hunter College",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={inter.variable}>
      <body>{children}</body>
    </html>
  );
}
