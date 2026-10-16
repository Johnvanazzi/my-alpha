import type { Metadata } from "next";
import { Nav } from "@/components/Nav";
import "./globals.css";

export const metadata: Metadata = {
  title: "my-alpha",
  description: "Portfolio tracking, technical and fundamental stock analysis",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <Nav />
        <main className="w-full px-4 py-8 lg:px-8">{children}</main>
      </body>
    </html>
  );
}
