import type { Metadata, Viewport } from "next";
import { Nav } from "@/components/Nav";
import "./globals.css";

export const metadata: Metadata = {
  title: "Fragments",
  description: "Say anything. It gets filed.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#0a0a0a",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className="dark">
      <body className="min-h-dvh bg-neutral-950 text-neutral-100 antialiased">
        <Nav />
        <main className="mx-auto max-w-xl px-4 pb-28 pt-6 sm:pb-10">{children}</main>
      </body>
    </html>
  );
}
