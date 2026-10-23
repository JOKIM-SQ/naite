import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'RELAY · 릴레이 — 문의가 답변으로 이어지는 곳',
  description: '고객의 문의를 분류하고 답변 초안을 준비하는, 차분한 CS 작업 공간.',
  icons: { icon: '/icon.svg' },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="ko"><body>{children}</body></html>;
}
