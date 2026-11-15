import type { Metadata } from "next";
import { UsageTracker } from "@/components/usage/usage-tracker";
import "./globals.css";

export const metadata: Metadata = {
  title: "ASCEND",
  description: "A private RPG-style personal development app",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen">
        <UsageTracker />
        {children}
      </body>
    </html>
  );
}
