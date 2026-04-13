import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Say It",
  description: "Say what you've been meaning to say.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
