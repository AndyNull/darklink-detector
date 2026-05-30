import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { ThemeProvider } from "next-themes";
import "./globals.css";
import { Toaster as SonnerToaster } from '@/components/ui/sonner';

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "暗链检测系统",
  description: "高性能网页暗链检测工具，支持批量URL扫描、QR码解析、暗链分析等功能。基于Bun并发引擎实现快速扫描。",
  keywords: ["暗链检测", "DarkLink", "安全扫描", "网页安全", "QR码检测"],
  authors: [{ name: "DarkLink Detector" }],
  icons: {
    icon: "https://z-cdn.chatglm.cn/z-ai/static/logo.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN" suppressHydrationWarning>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased bg-background text-foreground`}
      >
        <ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
          {children}
        </ThemeProvider>
        <SonnerToaster position="top-center" richColors closeButton duration={2000} />
      </body>
    </html>
  );
}
