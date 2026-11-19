import React from 'react';
import {createRoot} from 'react-dom/client';
import Home from '../app/page';
import Kiosk from '../app/kiosk/page';
import {RegistrationForm} from '../app/register/registration-form';
import '../app/globals.css';

const url = new URL(window.location.href);
const registration = /^\/register\/([a-f\d-]{36})\/?$/i.exec(url.pathname);
const screen = registration
  ? <RegistrationForm eventId={registration[1]} correctionId={url.searchParams.get('correct') || undefined}/>
  : url.pathname.startsWith('/kiosk') ? <Kiosk/> : <Home/>;
createRoot(document.getElementById('root')).render(screen);
