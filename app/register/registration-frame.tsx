import type {ReactNode} from 'react';
import Image from 'next/image';
import {Globe, MapPin, Tablet} from 'lucide-react';
import styles from './registration.module.css';

export function RegistrationFrame({kiosk, title, location, children}:{
  kiosk: boolean;
  title: string;
  location?: string | null;
  children: ReactNode;
}) {
  const ModeIcon = kiosk ? Tablet : Globe;
  return <main className={styles.page}>
    <div className={styles.sheet}>
      <header className={styles.cover}>
        <div className={styles.brand}>
          <Image src="/aru-icon.jpg" width={60} height={60} alt="โลโก้องค์การนักศึกษา ARU"/>
          <div><strong>ARU Event Pass</strong><span>องค์การนักศึกษา มหาวิทยาลัยราชภัฏพระนครศรีอยุธยา</span></div>
        </div>
        <div className={styles.event}>
          <p><ModeIcon size={17} aria-hidden="true"/>{kiosk?'จุดลงทะเบียนหน้างาน':'ลงทะเบียนออนไลน์'}</p>
          <h1>{title}</h1>
          {location && <p className={styles.location}><MapPin size={16} aria-hidden="true"/>{location}</p>}
        </div>
      </header>
      <section className={styles.content}>{children}</section>
    </div>
  </main>;
}
