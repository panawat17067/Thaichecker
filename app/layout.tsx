import './globals.css'
import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Thai Checkers 16:9',
  description: 'เว็บหมากฮอสไทยสำหรับเล่นบนเดสก์ท็อปและมือถือ',
  viewport: 'width=device-width, initial-scale=1, maximum-scale=1, viewport-fit=cover',
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