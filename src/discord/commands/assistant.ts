
import { ChatInputCommandInteraction, LabelBuilder, MessageFlags, ModalBuilder, StringSelectMenuBuilder, TextInputBuilder, TextInputStyle, type InteractionEditReplyOptions, type InteractionUpdateOptions } from 'discord.js';
import type { AssistantService } from '../../application/assistant-service.js';
import type { WishlistViewService } from '../../application/wishlist-view-service.js';
import { formatMinorPrice } from '../notification-messages.js';
import { buildAssistantView, effectiveTimezone, type AssistantView, type AssistantViewData, type GameHistoryState, filteredAssistantItems } from '../assistant-view.js';
import { languageFromDiscordLocale } from '../language.js';
import { localizer } from '../i18n.js';
import { messagesFor } from '../messages.js';
import { uiCopy } from '../ui/copy.js';
import { buildNoticePanel, dealioV2Flags, dealioEphemeralV2Flags, dealioUiSessionTimeoutMs } from '../ui/components-v2.js';
import { dealioUiSessions } from '../ui/session-manager.js';
import { PanelOperationQueue } from '../ui/operation-queue.js';
import { safeLogger } from '../../application/safe-logger.js';
import { handOffPanel, parseTabAction, type PanelNavigation } from '../ui/tab-bar.js';
import { measureDiscordOperation } from '../interaction-timing.js';
import type { GameRule } from '../../persistence/assistant-repository.js';
import type { NotificationPreference } from '../../domain/notification-preference.js';

export function parseTargetMinor(raw:string):number|null {
  if(!/^\d{1,10}([.,]\d{1,2})?$/.test(raw.trim())) return null;
  const [whole,fraction='']=raw.trim().replace(',','.').split('.');
  const result=Number(whole)*100+Number(fraction.padEnd(2,'0'));
  return Number.isSafeInteger(result)?result:null;
}
const nightStart=23*60, nightEnd=8*60, eveningDigest=19*60;
/** The stored fields a timing change keeps, so switching modes does not forget earlier hours. */
function savedPreference(p:NotificationPreference):NotificationPreference {
  return {mode:p.mode,timezone:p.timezone,quietStart:p.quietStart,quietEnd:p.quietEnd,digestMinute:p.digestMinute};
}

export async function handleAssistant(interaction:ChatInputCommandInteraction, service:AssistantService,
  wishlist:WishlistViewService, signal?:AbortSignal, screen:AssistantView['screen']='wishlist', ui:PanelNavigation={}):Promise<void> {
  const editPanel=(options:Parameters<typeof interaction.editReply>[0])=>
    measureDiscordOperation(interaction,'assistant.render',()=>interaction.editReply(options));
  const loadWishlist=(refresh=false)=>measureDiscordOperation(interaction,'assistant.load',()=>wishlist.load(interaction.user.id,language,refresh));
  if(!ui.inPlace) await measureDiscordOperation(interaction,'assistant.ack',()=>interaction.deferReply({flags:MessageFlags.Ephemeral}));
  const user=interaction.user.id, config=service.config(user), language=config?.language??languageFromDiscordLocale(interaction.locale);
  const t=localizer(language), messages=messagesFor(language), text=uiCopy(language);
  const chooseTimezoneFirst=t({tr:'Önce aşağıdan saat dilimini seç.',en:'Choose your time zone below first.',
    de:'Wähle zuerst unten deine Zeitzone.',fr:'Choisis d’abord ton fuseau horaire ci-dessous.'});
  const timingSaved=t({tr:'Tamam, bildirim zamanını kaydettim.',en:'Got it, alert timing saved.',
    de:'Alles klar, Benachrichtigungszeit gespeichert.',fr:'C’est noté, horaire des alertes enregistré.'});
  const refreshFailed=t({tr:'Steam’den yenileyemedim; son kaydettiğim listeyi gösteriyorum.',en:'I couldn’t refresh from Steam, so here’s the last saved list.',
    de:'Ich konnte nicht von Steam aktualisieren; hier ist die zuletzt gespeicherte Liste.',fr:'Impossible d’actualiser depuis Steam ; voici la dernière liste enregistrée.'});
  const hourField=(id:string,label:string,selectedMinute:number)=>new LabelBuilder().setLabel(label)
    .setStringSelectMenuComponent(new StringSelectMenuBuilder().setCustomId(id).setRequired(true).setMinValues(1).setMaxValues(1)
      .addOptions(Array.from({length:24},(_,hour)=>({label:String(hour).padStart(2,'0')+':00',value:String(hour*60),default:hour*60===selectedMinute}))));
  const cooldownNotice=(seconds:number)=>t({
    tr:`Az önce yeniledim. ${seconds} saniye sonra yeniden deneyebilirsin; bu süre tüm panellerin için geçerli.`,
    en:`I just refreshed. You can try again in ${seconds} seconds; this applies to all your panels.`,
    de:`Ich habe gerade aktualisiert. In ${seconds} Sekunden geht es wieder; das gilt für alle deine Panels.`,
    fr:`Je viens d’actualiser. Tu pourras réessayer dans ${seconds} secondes ; ça vaut pour tous tes panneaux.`});
  if(!config) {
    await editPanel({flags:dealioV2Flags,components:[buildNoticePanel(language,'warning',
      text.notSetUpTitle,messages.notConfigured)]});return;
  }
  const result=screen==='wishlist'||screen==='detail'?await loadWishlist():null;
  if(result && result.status!=='success') {
    await editPanel({flags:dealioV2Flags,components:[buildNoticePanel(language,'warning',
      result.status==='cooldown'?text.checkCooldownTitle:t({tr:'İstek listene ulaşamadım',en:'Couldn’t load your wishlist',de:'Wunschliste nicht erreichbar',fr:'Liste de souhaits inaccessible'}),
      result.status==='cooldown'?cooldownNotice(result.retryAfterSeconds):messages.unavailable)]});return;
  }
  let items:AssistantViewData['items']=result?.items??[],capturedAt=result?.capturedAt??new Date().toISOString();
  let errors:AssistantViewData['errors']=result?.errors??[];
  let loaded=result!==null;
  const view:AssistantView={screen,page:0,query:'',eligibleOnly:false};
  const data=():AssistantViewData=>{
    const current=service.config(user);
    if(!current || current.configurationId!==config.configurationId || current.configVersion!==config.configVersion)
      throw new Error('Configuration changed');
    const selected=items.find(i=>i.appId===view.selectedAppId);
    const historyKey=selected?.price?.currency?`${current.storeCountryCode}:${selected.appId}:${selected.price.currency}`:null;
    return {config:current,items,errors,capturedAt,pollIntervalHours:service.pollIntervalHours,
      rules:view.screen==='wishlist'||view.screen==='detail'?service.repository.rules(current):new Map(),
      preference:service.repository.preference(user),history:view.screen==='history'?service.repository.history(user):[],
      ...(view.screen==='detail'&&service.priceHistory&&historyKey?{priceHistory:histories.get(historyKey)??{status:'loading'}}:{})};
  };
  // Price history is optional context: it loads beside the panel and never holds navigation.
  const histories=new Map<string,GameHistoryState>();
  const loadHistory=()=>{
    const current=service.config(user), selected=items.find(i=>i.appId===view.selectedAppId);
    if(!service.priceHistory||!current||!selected?.price?.currency)return;
    const app={appId:selected.appId,currency:selected.price.currency}, key=`${current.storeCountryCode}:${app.appId}:${app.currency}`;
    if(histories.has(key))return;
    histories.set(key,{status:'loading'});
    void service.priceHistory.gameHistory(app,current.storeCountryCode).catch(()=>null).then(history=>{
      histories.set(key,{status:'ready',history});
      return operations.enqueue(Promise.resolve(),async()=>{
        if(collector.ended||signal?.aborted||view.screen!=='detail'||view.selectedAppId!==app.appId)return;
        await render();
      });
    });
  };
  const render=async(disabled=false)=>{
    const panel:InteractionEditReplyOptions&InteractionUpdateOptions={flags:dealioV2Flags,components:[buildAssistantView(data(),view,interaction.id,disabled)]};
    await operations.edit(panel,()=>editPanel(panel));
  };
  // Register ownership before exposing controls.
  const close=dealioUiSessions.open(interaction.id,user,['assistant'],dealioUiSessionTimeoutMs);
  let message;
  try { message=await measureDiscordOperation(interaction,'assistant.open',()=>interaction.editReply({flags:dealioV2Flags,components:[buildAssistantView(data(),view,interaction.id)]})); }
  catch(error) { close();throw error; }
  const collector=message.createMessageComponentCollector({time:dealioUiSessionTimeoutMs,
    filter:c=>c.user.id===user&&c.customId.startsWith('assistant:'+interaction.id+':')});
  const operations=new PanelOperationQueue(async(error)=>{
    safeLogger.error('Assistant panel failed',error);
    await interaction.followUp({flags:dealioEphemeralV2Flags,components:[buildNoticePanel(language,'warning',
      text.actionFailedTitle,
      error instanceof Error && error.message==='Invalid amount' ? t({
        tr:'Tutarı 19,99 gibi yaz; virgülden sonra en fazla iki basamak olabilir.',en:'Enter an amount like 19.99, with at most two decimals.',
        de:'Gib einen Betrag wie 19,99 ein, mit höchstens zwei Nachkommastellen.',fr:'Saisis un montant comme 19,99, avec deux décimales au maximum.'})
      : error instanceof Error && error.message==='Invalid quiet hours' ? t({
        tr:'Başlangıç ve bitiş saati farklı olmalı.',en:'Start and end must be different hours.',
        de:'Beginn und Ende müssen unterschiedlich sein.',fr:'Le début et la fin doivent être différents.'})
      : error instanceof Error && error.message.includes('timezone') ? chooseTimezoneFirst
      : error instanceof Error && error.message==='Invalid percent' ? messages.discountThresholdInvalid
      : t({
        tr:'Girdiğin bilgiyi bir kontrol et. Hesabın ya da bölgen değiştiyse /dealio ile paneli yeniden aç.',
        en:'Please check what you entered. If your account or region changed, reopen /dealio.',
        de:'Prüf bitte deine Eingabe. Wenn sich Konto oder Region geändert haben, öffne /dealio neu.',
        fr:'Vérifie ce que tu as saisi. Si ton compte ou ta région a changé, rouvre /dealio.'}))]});
  });
  const modalTasks=new Set<Promise<void>>();
  let loadTask:Promise<void>|undefined;
  const startLoad=async(refresh:boolean)=>{
    if(loadTask)return;
    view.refreshing=true;
    try { await render(); } catch(error) { view.refreshing=false;throw error; }
    // Only applying the result belongs in the UI queue. Steam must not hold navigation behind it.
    loadTask=Promise.resolve().then(()=>loadWishlist(refresh)).then(
      fresh=>operations.enqueue(Promise.resolve(),async()=>{
        view.refreshing=false;
        if(collector.ended||signal?.aborted)return;
        if(fresh.status==='success'){items=fresh.items;errors=fresh.errors;capturedAt=fresh.capturedAt;loaded=true;}
        else if(fresh.status==='cooldown')view.notice=cooldownNotice(fresh.retryAfterSeconds);
        else view.notice=refreshFailed;
        await render();
      }),
      ()=>operations.enqueue(Promise.resolve(),async()=>{
        view.refreshing=false;
        if(collector.ended||signal?.aborted)return;
        view.notice=refreshFailed;
        await render();
      }),
    ).finally(()=>{loadTask=undefined;});
  };
  let sequence=0, handedOff=false;
  collector.on('collect',component=>{
    const acknowledge=()=>measureDiscordOperation(component,'assistant.button-ack',()=>component.deferUpdate());
    const tab=parseTabAction(component.customId.split(':')[2]??'');
    if(tab&&tab!=='games'&&tab!=='alerts'){
      if(ui.navigate){handedOff=true;handOffPanel({component,target:tab,navigate:ui.navigate,
        stop:()=>collector.stop('handoff'),settle:()=>operations.drain()});}
      else void acknowledge().catch(()=>undefined);
      return;
    }
    // Games and Alerts are screens of this panel; switching between them stays in this session.
    const action=tab==='games'?'wishlist':tab==='alerts'?'rhythm':component.customId.split(':')[2];
    if(['search','target','percent','quiet','digest'].includes(action)){
      const selected=items.find(i=>i.appId===view.selectedAppId);
      if((action==='target'||action==='percent')&&!selected){void acknowledge().catch(()=>undefined);return;}
      const zone=effectiveTimezone(data());
      if((action==='quiet'||action==='digest')&&!zone){
        void operations.enqueueClick(component,'assistant',async()=>{view.notice=chooseTimezoneFirst;await render();});return;
      }
      const id='assistant-modal:'+interaction.id+':'+(++sequence);
      const modal=new ModalBuilder().setCustomId(id).setTitle(t(
        action==='search'?{tr:'İstek listende ara',en:'Search your wishlist',de:'Wunschliste durchsuchen',fr:'Chercher dans ta liste'}
        :action==='target'?{tr:'Hedef fiyatını belirle',en:'Set your target price',de:'Wunschpreis festlegen',fr:'Fixe ton prix cible'}
        :action==='percent'?{tr:'En az ne kadar indirim olsun?',en:'Minimum discount',de:'Mindestrabatt',fr:'Réduction minimale'}
        :action==='quiet'?{tr:'Rahatsız etme saatleri',en:'Do-not-disturb hours',de:'Ruhezeiten',fr:'Heures calmes'}
        :{tr:'Günlük özet saati',en:'Daily digest time',de:'Uhrzeit der Zusammenfassung',fr:'Heure du résumé'}));
      const field=(id:string,label:string,placeholder:string,value?:string)=>new LabelBuilder().setLabel(label)
        .setTextInputComponent(new TextInputBuilder().setCustomId(id).setStyle(TextInputStyle.Short).setRequired(true)
          .setMaxLength(100).setPlaceholder(placeholder).setValue(value??''));
      if(action==='quiet'||action==='digest'){
        const p=service.repository.preference(user);
        if(action==='quiet') modal.addLabelComponents(
          hourField('start',t({tr:'Bildirimler şu saatte dursun',en:'Pause alerts from',de:'Pausieren ab',fr:'Couper les alertes à'}),p.quietStart??nightStart),
          hourField('end',t({tr:'Şu saatte yeniden başlasın',en:'Resume alerts at',de:'Wieder aktiv ab',fr:'Les reprendre à'}),p.quietEnd??nightEnd));
        else modal.addLabelComponents(hourField('time',t({tr:'Özet şu saatte gelsin',en:'Send the digest at',de:'Zusammenfassung um',fr:'Envoyer le résumé à'}),p.digestMinute??eveningDigest));
      } else modal.addLabelComponents(field('value',action==='target'
        ?t({tr:'Hedef fiyat',en:'Target price',de:'Wunschpreis',fr:'Prix cible'})+' · '+(selected?.price?.currency??'')
        :action==='percent'?messages.statusMinimumDiscountInputLabel
        :t({tr:'Oyun adı (temizlemek için *)',en:'Game name (* to clear)',de:'Spielname (* zum Zurücksetzen)',fr:'Nom du jeu (* pour effacer)'}),
        action==='target'?t({tr:'19,99',en:'19.99',de:'19,99',fr:'19,99'}):action==='percent'?'50'
        :t({tr:'Oyun adı',en:'Game name',de:'Spielname',fr:'Nom du jeu'})));
      const task=(async()=>{
        await measureDiscordOperation(component,'assistant.modal',()=>component.showModal(modal));
        const submit=await component.awaitModalSubmit({time:dealioUiSessionTimeoutMs,
          filter:m=>m.user.id===user&&m.customId===id}).catch(()=>null);
        if(!submit)return;
        if(collector.ended||signal?.aborted){await submit.reply({content:t({tr:'Bu panel kapandı. /dealio ile yenisini açabilirsin.',en:'This panel has closed. Open a new one with /dealio.',
          de:'Dieses Panel ist geschlossen. Öffne mit /dealio ein neues.',fr:'Ce panneau est fermé. Ouvre-en un nouveau avec /dealio.'}),flags:MessageFlags.Ephemeral});return;}
        const ack=measureDiscordOperation(submit,'assistant.modal-submit-ack',()=>submit.deferUpdate());
        await operations.enqueue(ack,async()=>{
          if(action==='search'){view.query=submit.fields.getTextInputValue('value').trim();if(view.query==='*')view.query='';view.page=0;}
          else if(action==='quiet'||action==='digest'){
            const hour=(id:string)=>Number(submit.fields.getStringSelectValues(id)[0]);
            const p=savedPreference(service.repository.preference(user));
            await service.preference(user,config.configurationId,action==='quiet'
              ?{...p,mode:'quiet',timezone:zone,quietStart:hour('start'),quietEnd:hour('end')}
              :{...p,mode:'digest',timezone:zone,digestMinute:hour('time')},config.configVersion);
            view.screen='rhythm';view.notice=timingSaved;
          }else if(selected){
            const raw=submit.fields.getTextInputValue('value').trim();
            const existing=service.repository.rule(config,selected.appId);
            let rule:Omit<GameRule,'revision'>;
            if(action==='target'){
              const minor=parseTargetMinor(raw);
              if(minor===null||!selected.price?.currency)throw new Error('Invalid amount');
              rule={mode:'target',targetMinor:minor,currency:selected.price.currency,percent:null,muted:existing?.muted??false};
            }else{
              if(!/^\d{1,3}$/.test(raw)||Number(raw)>100)throw new Error('Invalid percent');
              rule={mode:'percent',percent:Number(raw),targetMinor:null,currency:null,muted:existing?.muted??false};
            }
            await service.rule(user,config.configurationId,selected.appId,rule,config.configVersion);
            view.notice=t({
              tr:'Kuralını kaydettim. Fiyat şu an uyuyorsa burada görürsün; bunun için ayrıca DM atmam.',
              en:'Rule saved. If today’s price already matches, you’ll see it here; I won’t DM you about it.',
              de:'Regel gespeichert. Passt der aktuelle Preis schon, siehst du es hier; dafür schicke ich keine DM.',
              fr:'Règle enregistrée. Si le prix actuel correspond déjà, tu le verras ici ; pas de MP pour ça.'});
          }
          await render();
        });
      })().catch(error=>safeLogger.error('Assistant modal failed',error));
      modalTasks.add(task);void task.finally(()=>modalTasks.delete(task));return;
    }
    void operations.enqueueClick(component,'assistant',async()=>{
      view.notice=undefined;
      if(action==='retry'){
        await service.retryDm(user,config.configurationId,config.configVersion);
        view.notice=t({
          tr:'Deneme DM’i Discord’a ulaştı. Takip kapalıysa /dealio → ⚙️ Ayarlar’dan bildirimleri açabilirsin.',
          en:'Test DM delivered to Discord. If tracking is paused, turn alerts on in /dealio → ⚙️ Settings.',
          de:'Test-DM an Discord zugestellt. Ist die Überwachung pausiert, schalte sie unter /dealio → ⚙️ Einstellungen ein.',
          fr:'MP de test remis à Discord. Si le suivi est en pause, réactive les alertes dans /dealio → ⚙️ Réglages.'});
      }
      else if(action==='game'&&component.isStringSelectMenu()){view.selectedAppId=Number(component.values[0]);view.screen='detail';loadHistory();}
      else if(action==='refresh'){
        await startLoad(true);return;
      }else if(action==='filter'){view.eligibleOnly=!view.eligibleOnly;view.page=0;}
      else if(action==='prev')view.page=Math.max(0,view.page-1);
      else if(action==='next'){
        const count=view.screen==='history'?data().history.length:filteredAssistantItems(data(),view).length;
        const size=view.screen==='history'?5:3;view.page=Math.min(Math.max(0,Math.ceil(count/size)-1),view.page+1);
      }else if(['wishlist','history','rhythm'].includes(action)){
        view.screen=action as AssistantView['screen'];view.page=0;
        if(action==='wishlist'&&!loaded){if(loadTask)await render();else await startLoad(false);return;}
      }
      else if(action==='instant'||action==='quiet-night'||action==='digest-evening'){
        const zone=effectiveTimezone(data()), p=savedPreference(service.repository.preference(user));
        if(action!=='instant'&&!zone)view.notice=chooseTimezoneFirst;
        else{
          await service.preference(user,config.configurationId,action==='instant'?{...p,mode:'instant',timezone:zone}
            :action==='quiet-night'?{...p,mode:'quiet',timezone:zone,quietStart:nightStart,quietEnd:nightEnd}
            :{...p,mode:'digest',timezone:zone,digestMinute:eveningDigest},config.configVersion);
          view.notice=timingSaved;
        }
      }
      else if(action==='timezone'&&component.isStringSelectMenu()){
        const p=savedPreference(service.repository.preference(user));
        await service.preference(user,config.configurationId,{...p,timezone:component.values[0]??p.timezone},config.configVersion);
        view.notice=t({tr:'Saat dilimini kaydettim.',en:'Time zone saved.',de:'Zeitzone gespeichert.',fr:'Fuseau horaire enregistré.'});
      }
      else if(action==='low'&&view.selectedAppId){
        const selected=items.find(i=>i.appId===view.selectedAppId), currency=selected?.price?.currency;
        const state=currency?histories.get(`${config.storeCountryCode}:${view.selectedAppId}:${currency}`):undefined;
        const low=state?.status==='ready'?state.history?.low:undefined;
        if(selected&&currency&&low&&low.currency===currency){
          const existing=service.repository.rule(config,selected.appId);
          await service.rule(user,config.configurationId,selected.appId,
            {mode:'target',targetMinor:low.amountMinor,currency,percent:null,muted:existing?.muted??false},config.configVersion);
          const amount=formatMinorPrice(low.amountMinor,currency,language);
          view.notice='🏆 '+t({
            tr:`Fiyat ${amount} ya da altına inince haber vereceğim.`,
            en:`I’ll DM you when the price drops to ${amount} or less.`,
            de:`Ich melde mich, sobald der Preis auf ${amount} oder weniger fällt.`,
            fr:`Je te préviens dès que le prix descend à ${amount} ou moins.`});
        }
      }
      else if((action==='inherit'||action==='mute')&&view.selectedAppId){
        const existing=service.repository.rule(config,view.selectedAppId)??{mode:'inherit',percent:null,targetMinor:null,currency:null,muted:false,revision:0};
        const rule=action==='mute'?{...existing,muted:!existing.muted}:{mode:'inherit' as const,percent:null,targetMinor:null,currency:null,muted:existing.muted};
        await service.rule(user,config.configurationId,view.selectedAppId,rule,config.configVersion);
      }
      await render();
    });
  });
  const abort=()=>collector.stop('shutdown');
  signal?.addEventListener('abort',abort,{once:true});
  if(signal?.aborted)abort();
  try{await new Promise<void>(resolve=>collector.once('end',()=>resolve()));await operations.drain();
    await loadTask;await operations.drain();
    if(!handedOff)await render(true).catch(()=>undefined);}
  finally{close();signal?.removeEventListener('abort',abort);}
  // Modal submissions are owner-bound and reject after collector end; they do not hold shutdown open.
}
