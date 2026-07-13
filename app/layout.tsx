import type { Metadata } from "next";
import "./globals.css";
import Nav from "@/components/Nav";

export const metadata: Metadata = {
  title: "Facebook Ads Studio",
  description: "Generate, preview, launch, and optimize Facebook ad campaigns",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <div className="flex min-h-screen">
          <Nav />
          <main className="flex-1 p-8 max-w-7xl mx-auto w-full">{children}</main>
        </div>
      </body>
    </html>
  );
}
