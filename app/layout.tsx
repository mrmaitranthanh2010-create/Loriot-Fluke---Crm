import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Loriot CRM | Mai Trần Thành",
  description: "Hệ thống CRM cá nhân của Mai Trần Thành tại Công ty TNHH Công Nghiệp Vàng Anh / Loriot Industrial.",
  openGraph: {
    title: "Loriot CRM | Mai Trần Thành",
    description: "Rõ việc, rõ cơ hội, rõ doanh thu.",
    images: [{ url: "/og.png", width: 1728, height: 909, alt: "Loriot CRM của Mai Trần Thành" }],
  },
  twitter: {
    card: "summary_large_image",
    title: "Loriot CRM | Mai Trần Thành",
    description: "Rõ việc, rõ cơ hội, rõ doanh thu.",
    images: ["/og.png"],
  },
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="vi">
      <body>{children}</body>
    </html>
  );
}
