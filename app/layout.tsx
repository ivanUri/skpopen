import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Modelroom — SketchUp Viewer",
  description: "Xem mô hình SketchUp trực tiếp trên trình duyệt.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="vi">
      <body>{children}</body>
    </html>
  );
}
