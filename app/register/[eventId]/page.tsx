import BrowserGate from '../../browser-gate';
import {RegistrationForm} from '../registration-form';

export default async function RegisterPage({params}:{params:Promise<{eventId:string}>}) {
  const {eventId}=await params;
  return <BrowserGate><RegistrationForm eventId={eventId}/></BrowserGate>;
}
