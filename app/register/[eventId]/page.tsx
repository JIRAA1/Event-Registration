import BrowserGate from '../../browser-gate';
import {RegistrationForm} from '../registration-form';

export default async function RegisterPage({params,searchParams}:{params:Promise<{eventId:string}>;searchParams:Promise<{correct?:string}>}) {
  const {eventId}=await params;
  const {correct}=await searchParams;
  return <BrowserGate><RegistrationForm key={eventId+':'+(correct||'')} eventId={eventId} correctionId={correct}/></BrowserGate>;
}
