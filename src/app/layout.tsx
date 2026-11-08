import type { Metadata, Viewport } from "next";
import { Geist } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Heyus Fredagskryss",
  description: "Lös korsord tillsammans med polarna, i realtid.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  interactiveWidget: "resizes-content",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="sv"
      className={`${geistSans.variable} h-full antialiased`}
    >
      <body className="flex h-dvh min-h-dvh flex-col bg-slate-950 text-slate-100">
        {children}
      </body>
    </html>
  );
}
