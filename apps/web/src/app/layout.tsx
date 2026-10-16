import type { Metadata } from "next";
import { JetBrains_Mono, Lilita_One, Rubik } from "next/font/google";
import "./globals.css";
import { Providers } from "@/components/Providers";
import { Header } from "@/components/Header";
import { SITE_URL } from "@/lib/config";

const lilita = Lilita_One({ weight: "400", subsets: ["latin"], variable: "--font-lilita" });
const rubik = Rubik({ subsets: ["latin"], variable: "--font-rubik" });
const jetbrains = JetBrains_Mono({ subsets: ["latin"], variable: "--font-jetbrains" });


export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: { default: "CHOG World", template: "%s · CHOG World" },
  description: "Every Chog has a look. Awaken yours and give it a life of its own.",
  applicationName: "CHOG World",
  openGraph: {
    title: "CHOG World",
    description: "Every Chog has a look. Awaken yours and give it a life of its own.",
    siteName: "CHOG World",
    type: "website",
  },
  twitter: { card: "summary_large_image", title: "CHOG World", description: "Every Chog has a look. Awaken yours and give it a life of its own." },
};

export const viewport = { themeColor: "#120c22" };

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body className={`${lilita.variable} ${rubik.variable} ${jetbrains.variable} antialiased`}>
        <Providers>
          <Header />
          <main className="mx-auto max-w-6xl px-4 pb-24 pt-8">{children}</main>
        </Providers>
      </body>
    </html>
  );
}
