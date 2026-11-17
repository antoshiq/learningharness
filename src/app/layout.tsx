import type { Metadata, Viewport } from "next";
// The code font is bundled with the app, so it looks the same on a phone.
import "@fontsource-variable/jetbrains-mono";
import "./globals.css";
import { Workbench } from "@/components/Workbench";
import { THEME_SCRIPT } from "@/lib/theme-script";

export const metadata: Metadata = {
  title: "Репетитор",
  description: "Личный репетитор по программированию и математике",
  manifest: "/manifest.webmanifest",
  appleWebApp: { capable: true, title: "Репетитор", statusBarStyle: "default" },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#e2e3e6" },
    { media: "(prefers-color-scheme: dark)", color: "#0c0d0f" },
  ],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    // The theme script sets data-theme before React hydrates, hence the warning suppression.
    <html lang="ru" className="h-full antialiased" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
      <body className="min-h-full">
        <Workbench>{children}</Workbench>
      </body>
    </html>
  );
}
