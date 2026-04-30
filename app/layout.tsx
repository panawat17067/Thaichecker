import './globals.css'
import type { Metadata, Viewport } from 'next'

export const metadata: Metadata = {
  title: 'Thai Checkers 16:9',
  description: 'เว็บหมากฮอสไทยสำหรับเล่นบนเดสก์ท็อปและมือถือ',
}

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  viewportFit: 'cover',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="th">
      <body>{children}</body>
    </html>
  )
}
