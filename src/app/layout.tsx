import type { Metadata } from "next";
import "./globals.css";
import { site } from "@/config/site";
import { VarukorgProvider } from "@/components/varukorg-context";

export const metadata: Metadata = {
  title: site.orgName,
  description: `${site.orgName} – beställ online och hämta hos oss.`,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="sv">
      <body className="min-h-screen bg-white text-black">
        <VarukorgProvider>{children}</VarukorgProvider>
      </body>
    </html>
  );
}
