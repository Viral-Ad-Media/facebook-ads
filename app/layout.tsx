import type { Metadata } from "next";
import "./globals.css";
import Nav from "@/components/Nav";
import RequestStatus from "@/components/RequestStatus";
import Onboarding from "@/components/Onboarding";

export const metadata: Metadata = {
  title: "Facebook Ads Studio",
  description: "Generate, preview, launch, and optimize Facebook ad campaigns",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>
        <div className="flex flex-col md:flex-row min-h-screen">
          <Nav />
          <main className="flex-1 min-w-0 p-4 md:p-8 max-w-7xl mx-auto w-full">
            <RequestStatus />
            {children}
          </main>
        </div>
        <Onboarding />
      </body>
    </html>
  );
}
