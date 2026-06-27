import type { Metadata } from "next";
import { I18nProvider } from "@/lib/i18n";
import "./globals.css";

export const metadata: Metadata = {
  title: "Stream Clipper",
  description: "Review livestream clip candidates quickly."
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ja">
      <body className="font-sans antialiased"><I18nProvider>{children}</I18nProvider></body>
    </html>
  );
}
