import type { Metadata, Viewport } from "next";
import { Hanken_Grotesk, Fraunces, Geist_Mono } from "next/font/google";
import { ThemeProvider } from "@/components/theme-provider";
import { ServiceWorkerRegister } from "@/components/pwa/service-worker-register";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { DEVELOPER } from "@/lib/branding";
import "./globals.css";

// Body / UI — a warm humanist grotesque with more character than the
// default Geist, while staying highly legible at small sizes.
const sans = Hanken_Grotesk({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

// Headings — an expressive editorial serif that gives the product an
// "awards night / judging panel" feel instead of a generic dashboard.
const display = Fraunces({
  variable: "--font-display",
  subsets: ["latin"],
  axes: ["opsz"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Eventify",
  description: "Dynamic event tabulation for configurable judging workflows.",
  applicationName: "Eventify",
  authors: [{ name: DEVELOPER }],
  creator: DEVELOPER,
  publisher: DEVELOPER,
  appleWebApp: {
    capable: true,
    title: "Eventify",
    statusBarStyle: "default",
  },
  icons: {
    icon: "/icons/icon-192.png",
    apple: "/icons/apple-icon-180.png",
  },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#ffffff" },
    { media: "(prefers-color-scheme: dark)", color: "#0e2a47" },
  ],
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={`${sans.variable} ${display.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-screen">
        <ThemeProvider
          attribute="class"
          defaultTheme="system"
          enableSystem
          disableTransitionOnChange
        >
          <TooltipProvider>
            {children}
            <Toaster richColors />
          </TooltipProvider>
          <ServiceWorkerRegister />
        </ThemeProvider>
      </body>
    </html>
  );
}
