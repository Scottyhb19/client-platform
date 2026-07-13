import type { Metadata } from "next";
import { Barlow, Barlow_Condensed } from "next/font/google";
import "./globals.css";

const barlow = Barlow({
  variable: "--font-barlow",
  subsets: ["latin"],
  weight: ["300", "400", "500", "600", "700"],
  display: "swap",
});

const barlowCondensed = Barlow_Condensed({
  variable: "--font-barlow-condensed",
  subsets: ["latin"],
  weight: ["700", "900"],
  display: "swap",
});

// PWA identity must live at the ROOT layout, not portal/layout.tsx: clients
// are told to "Add to Home Screen" on /welcome/install (and may install from
// /login), which render outside the portal segment. Any route missing the
// manifest + apple-touch-icon installs as a letter tile named from <title>
// — the "C / Client Platform" home-screen bug.
export const metadata: Metadata = {
  title: "OdysseyHQ.",
  description:
    "Clinical management + exercise programming for Exercise Physiology practice.",
  manifest: "/manifest.json",
  appleWebApp: {
    capable: true,
    title: "OdysseyHQ.",
    statusBarStyle: "default",
  },
  icons: {
    apple: {
      url: "/icons/icon-apple-touch.png",
      sizes: "180x180",
      type: "image/png",
    },
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${barlow.variable} ${barlowCondensed.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
