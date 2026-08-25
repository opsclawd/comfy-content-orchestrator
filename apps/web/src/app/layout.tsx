import type { ReactNode } from "react";
import "./globals.css";

export const metadata = {
  title: "Director Review Hub",
  description: "Director Review Hub & Private Review Plane"
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
      </head>
      <body>
        <main>{children}</main>
      </body>
    </html>
  );
}
