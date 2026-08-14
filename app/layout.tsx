import type { Metadata } from "next";
import { DM_Sans, Cormorant_Garamond } from "next/font/google";
import { LocaleProvider } from "@/contexts/LocaleContext";
import type { Locale } from "@/lib/i18n";
import "./globals.css";

const dmSans = DM_Sans({
  subsets: ["latin"],
  weight: ["300", "400", "500"],
  variable: "--font-dm-sans",
});

const cormorant = Cormorant_Garamond({
  subsets: ["latin"],
  weight: ["300", "400", "500"],
  variable: "--font-cormorant",
});

export const metadata: Metadata = {
  title: "Mizan — Legal Intelligence",
  description: "AI-powered legal assistant for Canadian law",
  icons: {
    icon: "/favicon.svg",
    apple: "/favicon.svg",
  },
};

export const viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: "cover",
  themeColor: "#0d1e38",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  // Default to English for Canadian desktop app
  const locale: Locale = "en";
  const dir = "ltr";

  return (
    <html lang={locale} dir={dir} className={`${dmSans.variable} ${cormorant.variable}`} suppressHydrationWarning>
      <head>
        <meta name="theme-color" content="#0d1e38" />
      </head>
      <body className={dmSans.className}>
        <LocaleProvider defaultLocale={locale}>
          {children}
        </LocaleProvider>
      </body>
    </html>
  );
}
