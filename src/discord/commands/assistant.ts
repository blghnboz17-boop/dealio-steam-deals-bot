
import { ChatInputCommandInteraction, LabelBuilder, MessageFlags, ModalBuilder, TextInputBuilder, TextInputStyle,
  type MessageComponentInteraction } from 'discord.js';
import type { AssistantService } from '../../application/assistant-service.js';
import type { WishlistViewService } from '../../application/wishlist-view-service.js';
import { buildAssistantView, type AssistantView, type AssistantViewData, filteredAssistantItems } from '../assistant-view.js';
import { languageFromDiscordLocale } from '../language.js';
import { buildNoticePanel, dealioV2Flags, dealioEphemeralV2Flags, dealioUiSessionTimeoutMs } from '../ui/components-v2.js';
import { dealioUiSessions } from '../ui/session-manager.js';
import { PanelOperationQueue } from '../ui/operation-queue.js';
import { safeLogger } from '../../application/safe-logger.js';
import type { GameRule } from '../../persistence/assistant-repository.js';
import type { NotificationPreference } from '../../domain/notification-preference.js';

export function parseTargetMinor(raw:string):number|null {
  if(!/^\d{1,10}([.,]\d{1,2})?$/.test(raw.trim())) return null;
  const [whole,fraction='']=raw.trim().replace(',','.').split('.');
  const result=Number(whole)*100+Number(fraction.padEnd(2,'0'));
  return Number.isSafeInteger(result)?result:null;
}
function parseClock(value:string):number {
  if(!/^([01]\d|2[0-3]):[0-5]\d$/.test(value)) throw new Error('HH:MM');
  const [h,m]=value.split(':').map(Number); return h*60+m;
}

export async function handleAssistant(interaction:ChatInputCommandInteraction, service:AssistantService,
  wishlist:WishlistViewService, signal?:AbortSignal, screen:AssistantView['screen']='wishlist'):Promise<void> {
  await interaction.deferReply({flags:MessageFlags.Ephemeral});
  const user=interaction.user.id, config=service.config(user), language=config?.language??languageFromDiscordLocale(interaction.locale);
  const tr=language==='tr';
  if(!config) {
    await interaction.editReply({flags:dealioV2Flags,components:[buildNoticePanel(language,'warning',
      tr?'Önce Steam hesabını bağla':'Connect Steam first',tr?'/setup ile başlayabilirsin.':'Start with /setup.')]});return;
  }
  const result=await wishlist.load(user,language);
  if(result.status!=='success') {
    await interaction.editReply({flags:dealioV2Flags,components:[buildNoticePanel(language,'warning',
      tr?'Wishlist alınamadı':'Wishlist unavailable',tr?'Steam’e erişilemiyor. Biraz sonra yeniden dene.':'Steam is unavailable. Try again shortly.')]});return;
  }
  let items=result.items,capturedAt=result.capturedAt;
  const view:AssistantView={screen,page:0,query:'',eligibleOnly:false};
  const data=():AssistantViewData=>{
    const current=service.config(user);
    if(!current || current.configurationId!==config.configurationId) throw new Error('Configuration changed');
    const selected=items.find(i=>i.appId===view.selectedAppId);
    return {config:current,items,capturedAt,rules:new Map(items.flatMap(item=>{
      const rule=service.repository.rule(current,item.appId);return rule?[[item.appId,rule] as const]:[];
    })),preference:service.repository.preference(user),history:service.repository.history(user),
    prices:selected?.price?.currency?service.repository.prices(selected.appId,current.storeCountryCode,selected.price.currency):[]};
  };
  const render=async(disabled=false)=>{
    await interaction.editReply({flags:dealioV2Flags,components:[buildAssistantView(data(),view,interaction.id,disabled)]});
  };
  // Register ownership before exposing controls.
  const close=dealioUiSessions.open(interaction.id,user,['assistant'],dealioUiSessionTimeoutMs);
  let message;
  try { message=await interaction.editReply({flags:dealioV2Flags,components:[buildAssistantView(data(),view,interaction.id)]}); }
  catch(error) { close();throw error; }
  const collector=message.createMessageComponentCollector({time:dealioUiSessionTimeoutMs,
    filter:c=>c.user.id===user&&c.customId.startsWith('assistant:'+interaction.id+':')});
  const operations=new PanelOperationQueue(async(error)=>{
    safeLogger.error('Assistant panel failed',error);
    await interaction.followUp({flags:dealioEphemeralV2Flags,components:[buildNoticePanel(language,'warning',
      tr?'İşlem tamamlanamadı':'Could not complete',
      error instanceof Error && error.message==='Invalid amount' ? (tr?'Tutarı 19,99 gibi, en fazla iki ondalık basamakla gir.':'Enter an amount such as 19.99 with at most two decimals.')
      : error instanceof Error && (error.message.includes('timezone') || error.message==='HH:MM') ? (tr?'Europe/Istanbul gibi bir IANA saat dilimi ve 23:00-08:00 veya 19:00 biçiminde saat gir.':'Use an IANA timezone such as Europe/London and a time such as 23:00-08:00 or 19:00.')
      : error instanceof Error && error.message==='Invalid percent' ? (tr?'İndirim oranı 0–100 arasında tam sayı olmalı.':'Discount must be a whole number from 0 to 100.')
      : tr?'Bilgileri kontrol et. Hesap veya bölge değiştiyse /dealio ile paneli yeniden aç.':'Check the input. If account or region changed, reopen /dealio.')]});
  });
  const modalTasks=new Set<Promise<void>>();
  let sequence=0;
  collector.on('collect',component=>{
    const action=component.customId.split(':')[2];
    if(['search','target','percent','quiet','digest'].includes(action)){
      const selected=items.find(i=>i.appId===view.selectedAppId);
      if((action==='target'||action==='percent')&&!selected){void component.deferUpdate().catch(()=>undefined);return;}
      const id='assistant-modal:'+interaction.id+':'+(++sequence);
      const modal=new ModalBuilder().setCustomId(id).setTitle(action==='search'?(tr?'Wishlistinde ara':'Search your wishlist'):
        action==='target'?(tr?'Hedef fiyatını seç':'Choose your target price'):action==='percent'?(tr?'Minimum indirim':'Minimum discount'):
        action==='quiet'?(tr?'Sessiz saatlerini seç':'Choose quiet hours'):(tr?'Günlük özet saati':'Daily digest time'));
      const field=(id:string,label:string,placeholder:string,value?:string)=>new LabelBuilder().setLabel(label)
        .setTextInputComponent(new TextInputBuilder().setCustomId(id).setStyle(TextInputStyle.Short).setRequired(true)
          .setMaxLength(100).setPlaceholder(placeholder).setValue(value??''));
      if(action==='quiet'||action==='digest'){
        const p=service.repository.preference(user);
        modal.addLabelComponents(field('timezone',tr?'IANA saat dilimi':'IANA timezone','Europe/Istanbul',p.timezone??undefined));
        modal.addLabelComponents(field('time',action==='quiet'?(tr?'Başlangıç - bitiş':'Start - end'):(tr?'Özet saati':'Digest time'),
          action==='quiet'?'23:00-08:00':'19:00'));
      } else modal.addLabelComponents(field('value',action==='target'?(tr?'Hedef fiyat · ':'Target price · ')+(selected?.price?.currency??''):
        action==='percent'?(tr?'Yüzde (0–100)':'Percent (0–100)'):(tr?'Oyun adı (temizlemek için *)':'Game name (* to clear)'),
        action==='target'?'19.99':action==='percent'?'50':tr?'Oyun adı':'Game name'));
      const task=(async()=>{
        await component.showModal(modal);
        const submit=await component.awaitModalSubmit({time:dealioUiSessionTimeoutMs,
          filter:m=>m.user.id===user&&m.customId===id}).catch(()=>null);
        if(!submit)return;
        if(collector.ended||signal?.aborted){await submit.reply({content:tr?'Panel kapandı. /dealio ile yeniden aç.':'Panel closed. Reopen /dealio.',flags:MessageFlags.Ephemeral});return;}
        const ack=submit.deferUpdate();
        await operations.enqueue(ack,async()=>{
          if(action==='search'){view.query=submit.fields.getTextInputValue('value').trim();if(view.query==='*')view.query='';view.page=0;}
          else if(action==='quiet'||action==='digest'){
            const timezone=submit.fields.getTextInputValue('timezone').trim(),raw=submit.fields.getTextInputValue('time').trim();
            let p:NotificationPreference;
            if(action==='quiet'){
              const [start,end]=raw.split('-');
              p={mode:'quiet',timezone,quietStart:parseClock(start),quietEnd:parseClock(end??''),digestMinute:null};
            }else p={mode:'digest',timezone,quietStart:null,quietEnd:null,digestMinute:parseClock(raw)};
            await service.preference(user,config.configurationId,p);
            view.screen='rhythm';view.notice=tr?'Bildirim ritmin kaydedildi.':'Alert timing saved.';
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
            await service.rule(user,config.configurationId,selected.appId,rule);
            view.notice=tr?'Kural kaydedildi. Şu anda uygun fiyat varsa burada gösterilir; başlangıç DM’i gönderilmez.':'Rule saved. A currently matching price is shown here without an initial DM.';
          }
          await render();
        });
      })().catch(error=>safeLogger.error('Assistant modal failed',error));
      modalTasks.add(task);void task.finally(()=>modalTasks.delete(task));return;
    }
    void operations.enqueue(component.deferUpdate(),async()=>{
      view.notice=undefined;
      if(action==='retry'){
        await service.retryDm(user,config.configurationId);
        view.notice=tr?'Deneme DM’i Discord’a iletildi. Takip kapalıysa /dealio ayarlarından bildirimleri açabilirsin.':'Test DM delivered to Discord. If tracking is paused, enable alerts in /dealio settings.';
      }
      else if(action==='game'&&component.isStringSelectMenu()){view.selectedAppId=Number(component.values[0]);view.screen='detail';}
      else if(action==='refresh'){
        view.refreshing=true;await render();
        const fresh=await wishlist.load(user,language,true);view.refreshing=false;
        if(fresh.status==='success'){items=fresh.items;capturedAt=fresh.capturedAt;view.page=0;}
        else view.notice=tr?'Steam yenilemesi başarısız. Son kayıtlı liste gösteriliyor.':'Steam refresh failed. Showing the last saved wishlist.';
      }else if(action==='filter'){view.eligibleOnly=!view.eligibleOnly;view.page=0;}
      else if(action==='prev')view.page=Math.max(0,view.page-1);
      else if(action==='next'){
        const count=view.screen==='history'?data().history.length:filteredAssistantItems(data(),view).length;
        const size=view.screen==='history'?5:3;view.page=Math.min(Math.max(0,Math.ceil(count/size)-1),view.page+1);
      }else if(['wishlist','history','rhythm'].includes(action)){view.screen=action as AssistantView['screen'];view.page=0;}
      else if(action==='instant')await service.preference(user,config.configurationId,{mode:'instant',timezone:null,quietStart:null,quietEnd:null,digestMinute:null});
      else if((action==='inherit'||action==='mute')&&view.selectedAppId){
        const existing=service.repository.rule(config,view.selectedAppId)??{mode:'inherit',percent:null,targetMinor:null,currency:null,muted:false,revision:0};
        const rule=action==='mute'?{...existing,muted:!existing.muted}:{mode:'inherit' as const,percent:null,targetMinor:null,currency:null,muted:existing.muted};
        await service.rule(user,config.configurationId,view.selectedAppId,rule);
      }
      await render();
    });
  });
  const abort=()=>collector.stop('shutdown');
  signal?.addEventListener('abort',abort,{once:true});
  if(signal?.aborted)abort();
  try{await new Promise<void>(resolve=>collector.once('end',()=>resolve()));await operations.drain();
    await render(true).catch(()=>undefined);}
  finally{close();signal?.removeEventListener('abort',abort);}
  // Modal submissions are owner-bound and reject after collector end; they do not hold shutdown open.
}
