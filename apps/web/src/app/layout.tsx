import type { ReactNode } from "react";

export const metadata = {
  title: "Director Review Hub",
  description: "Director Review Hub & Private Review Plane"
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <main>{children}</main>
      </body>
    </html>
  );
}
