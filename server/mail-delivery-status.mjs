import {AppError,need} from '../src/domain.mjs';
import {configuration} from '../src/worker.mjs';

const details={
  sent:'An den Versanddienst übergeben. Die Zustellung ist noch nicht bestätigt.',
  delivered:'Vom empfangenden Mailserver angenommen. Ob die E-Mail im Posteingang oder Spamordner liegt, ist nicht feststellbar.',
  delivery_delayed:'Die Zustellung verzögert sich beim Empfänger. Keine neue E-Mail auslösen; den vorhandenen Versand erneut prüfen.',
  bounced:'Nicht zugestellt: Der empfangende Mailserver hat die E-Mail abgewiesen. Bitte die Kundenadresse prüfen, bevor erneut versendet wird.',
  suppressed:'Versand unterdrückt: Der Versanddienst meldet für diese E-Mail eine gesperrte Empfängeradresse. Bitte Adresse und Sperrgrund beim Anbieter prüfen.',
  complained:'Der Empfänger hat die E-Mail als Spam gemeldet. Keine weitere E-Mail ohne Klärung versenden.',
  failed:'Der Versanddienst meldet einen fehlgeschlagenen Versand. Bitte den Grund beim Anbieter prüfen; keine automatische Wiederholung.',
  scheduled:'Der Versanddienst hat die E-Mail vorgemerkt. Sie ist noch nicht zugestellt.',
  canceled:'Der vorgemerkte Versand wurde abgebrochen. Es wird keine neue E-Mail ausgelöst.',
  opened:'Der Versanddienst meldet ein Öffnungsereignis. Das beweist weder persönliches Lesen noch die Ablage im Posteingang.',
  clicked:'Der Versanddienst meldet ein Klickereignis. Das beweist weder eine persönliche Bestätigung noch die Ablage im Posteingang.'
};

// A verified provider ID resolves an uncertain request without making it retryable.
// The caller may persist state/detail while preserving the job and its provider ID.
export async function checkMailDelivery(env,job,recipient){
  need(job&&['unknown','sent'].includes(job.state)&&typeof job.provider_id==='string'&&job.provider_id.length>0&&job.provider_id.length<=256,'Für diese E-Mail liegt keine prüfbare Versandbestätigung vor.',409);
  const expected=String(recipient??'').trim().toLowerCase();
  need(/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(expected),'Die Empfängeradresse für den Versandabgleich fehlt.',409);
  const config=await configuration(env,['resendKey']);
  need(config.resendKey,'Der Zugang zum E-Mail-Anbieter fehlt.',409);
  let response;
  try{
    response=await fetch('https://api.resend.com/emails/'+encodeURIComponent(job.provider_id),{method:'GET',redirect:'manual',signal:AbortSignal.timeout(15000),headers:{Authorization:'Bearer '+config.resendKey}});
  }catch{
    throw new AppError('Der Zustellstatus konnte nicht gelesen werden. Der bisherige Versand bleibt unverändert.',502);
  }
  need(response.ok,'Der Zustellstatus konnte nicht gelesen werden. Der bisherige Versand bleibt unverändert.',502);
  const remote=await response.json().catch(()=>null);
  need(remote?.id===job.provider_id&&Array.isArray(remote.to)&&remote.to.some(value=>typeof value==='string'&&value.trim().toLowerCase()===expected),'Die Anbieterantwort gehört nicht eindeutig zu dieser E-Mail und Empfängeradresse.',409);
  const providerStatus=typeof remote.last_event==='string'&&Object.hasOwn(details,remote.last_event)?remote.last_event:'unknown';
  const multipleRecipients=remote.to.length>1||(Array.isArray(remote.cc)&&remote.cc.length>0)||(Array.isArray(remote.bcc)&&remote.bcc.length>0);
  const detail=(details[providerStatus]??'Der Versanddienst kennt die E-Mail, meldet aber keinen eindeutigen Zustellstatus. Keine neue E-Mail auslösen.')+(multipleRecipients?' Diese E-Mail hat mehrere Empfänger; der letzte Anbieterstatus belegt nicht die Zustellung an jeden Einzelnen.':'');
  return {state:'sent',providerStatus,detail};
}
