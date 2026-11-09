import type { Metadata, Viewport } from 'next';
import './globals.css';

export const viewport: Viewport = { colorScheme: 'light' };

export const metadata: Metadata = {
  title: 'ARU Event Pass · ระบบลงทะเบียนกิจกรรม',
  description: 'ระบบลงทะเบียนและเช็กอินกิจกรรมองค์การนักศึกษา มรภ.พระนครศรีอยุธยา',
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="th"><body>{children}</body></html>;
}
