import type { Metadata } from "next";
import { JetBrains_Mono, Lilita_One, Rubik } from "next/font/google";
import "./globals.css";
import { Providers } from "@/components/Providers";
import { Header } from "@/components/Header";

const lilita = Lilita_One({ weight: "400", subsets: ["latin"], variable: "--font-lilita" });
const rubik = Rubik({ subsets: ["latin"], variable: "--font-rubik" });
const jetbrains = JetBrains_Mono({ subsets: ["latin"], variable: "--font-jetbrains" });

export const metadata: Metadata = {
  title: "CHOG World",
  description: "Every Chog was born identical. Awaken yours and watch it become someone.",
};

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
