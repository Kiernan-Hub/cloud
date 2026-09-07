import type { Metadata } from "next";
import Link from "next/link";

import "./globals.css";

export const metadata: Metadata = {
  title: "Gatekeeper",
  description: "Run and track your project's quality gates.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en">
      <body>
        <header className="site-header">
          <div className="container">
            <h1 className="site-title">
              <Link href="/">Gatekeeper</Link>
            </h1>
            <p className="tagline">Which gates block you, lie to you, and drift.</p>
          </div>
        </header>
        <main className="container">{children}</main>
      </body>
    </html>
  );
}
