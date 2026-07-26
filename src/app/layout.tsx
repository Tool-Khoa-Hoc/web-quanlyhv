import type { Metadata, Viewport } from "next";
import { Be_Vietnam_Pro, Space_Grotesk } from "next/font/google";
import "./globals.css";

const beVietnamPro = Be_Vietnam_Pro({
  subsets: ["latin", "vietnamese"],
  variable: "--font-be-vietnam",
  display: "swap",
  weight: ["400", "500", "600", "700"],
});

// Space Grotesk chỉ dùng cho các CON SỐ lớn (tiền, doanh thu) — tạo cảm giác
// "bảng tỉ số đấu trường". Chữ tiếng Việt vẫn dùng Be Vietnam Pro (dấu chuẩn),
// nên chỉ cần subset latin cho font hiển thị này.
const spaceGrotesk = Space_Grotesk({
  subsets: ["latin"],
  variable: "--font-display",
  display: "swap",
  weight: ["500", "600", "700"],
});

export const metadata: Metadata = {
  title: "Đấu Trường Học Tập · Quản lý khóa học",
  description: "Web app nội bộ quản lý bán khóa học, học thử và Google Group.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="vi" suppressHydrationWarning>
      <body className={`${beVietnamPro.variable} ${spaceGrotesk.variable}`}>
        <a className="skip-link" href="#main-content">
          Bỏ qua điều hướng
        </a>
        {children}
      </body>
    </html>
  );
}
