import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "PedX Visualizer - Global Pedestrian Safety Analytics",
  description: "Interactive 3D visualization of pedestrian crossing behavior and safety metrics across 600+ cities worldwide. Explore crossing speeds, risky behavior patterns, and urban safety insights on an interactive globe.",
  keywords: ["pedestrian safety", "urban analytics", "traffic safety", "crossing behavior", "city data", "3D visualization", "global data"],
  authors: [{ name: "PedX Research Team" }],
  openGraph: {
    title: "PedX Visualizer - Global Pedestrian Safety Analytics",
    description: "Explore pedestrian crossing behavior and safety metrics across 600+ cities on an interactive 3D globe.",
    type: "website",
    locale: "en_US",
    siteName: "PedX Visualizer",
  },
  twitter: {
    card: "summary_large_image",
    title: "PedX Visualizer - Global Pedestrian Safety Analytics",
    description: "Explore pedestrian crossing behavior and safety metrics across 600+ cities on an interactive 3D globe.",
  },
  icons: {
    icon: [
      {
        url: "data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 100 100%22><text y=%22.9em%22 font-size=%2290%22>🗺️</text></svg>",
        type: "image/svg+xml",
      },
    ],
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        {children}
      </body>
    </html>
  );
}
