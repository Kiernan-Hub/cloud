import type { Metadata } from "next";
import Link from "next/link";

import "./globals.css";

// Deliberately no next/font/google: it fetches from an external host at
// build time, which would break the "CI reaches no external network host"
// requirement in the Milestone 1 breakdown. System font stack instead.

export const metadata: Metadata = {
  title: "HoosRadar",
  description:
    "Campus events from public UVA sources, in one place, with a link back to the original.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en">
      <body>
        <header className="site-header">
          <div className="container">
            <h1 className="site-title">
              <Link href="/">HoosRadar</Link>
            </h1>
            <p className="tagline">
              Public UVA campus events, with a link back to every source.
            </p>
          </div>
        </header>
        <main className="container">{children}</main>
      </body>
    </html>
  );
}
