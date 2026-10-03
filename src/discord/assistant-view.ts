import { artworkAccessory, addArtwork } from './ui/game-artwork.js';

import { ActionRowBuilder, ButtonBuilder, ButtonStyle, ContainerBuilder,
  SectionBuilder, StringSelectMenuBuilder, TextDisplayBuilder, escapeMarkdown } from 'discord.js';
import type { WishlistItem } from '../domain/steam.js';
import type { UserConfig } from '../domain/user-config.js';
import type { GameRule, HistoryEntry } from '../persistence/assistant-repository.js';
import type { NotificationPreference } from '../domain/notification-preference.js';
import type { GameHistory } from '../domain/price-history.js';
import { formatMinorPrice } from './notification-messages.js';
import { historicalLowLine, priceChangeLine, priceHistoryCredit } from './price-history-text.js';
import { assertComponentsV2Limit } from './ui/components-v2.js';
import { buildTabBar } from './ui/tab-bar.js';
import { defaultTimezone, timezoneChoices, timezoneLabel } from '../domain/timezone.js';
import { dealioBrand } from './ui/brand.js';

export interface AssistantView {
  screen:'wishlist'|'detail'|'history'|'rhythm'; page:number; query:string; eligibleOnly:boolean;
  selectedAppId?:number; notice?:string; refreshing?:boolean;
}
export interface AssistantViewData {
  config:UserConfig; items:readonly WishlistItem[]; capturedAt:string;
  rules:ReadonlyMap<number,GameRule>; preference:NotificationPreference; history:HistoryEntry[];
  /** Absent when price history is not configured; the detail panel then omits the section. */
  priceHistory?:GameHistoryState;
}
export type GameHistoryState={status:'loading'}|{status:'ready';history:GameHistory|null};
const text=(value:string)=>new TextDisplayBuilder().setContent(value);
const button=(id:string,label:string,primary=false)=>new ButtonBuilder().setCustomId(id).setLabel(label).setStyle(primary?ButtonStyle.Primary:ButtonStyle.Secondary);
/** The saved time zone, else the Store region's own zone; null when the user must choose. */
export function effectiveTimezone(data:Pick<AssistantViewData,'preference'|'config'>):string|null {
  return data.preference.timezone??defaultTimezone(data.config.storeCountryCode);
}
const clock=(minute:number|null)=>minute===null?'—':String(Math.floor(minute/60)).padStart(2,'0')+':'+String(minute%60).padStart(2,'0');
export function matchesRule(item:WishlistItem,rule:GameRule|undefined,global:number):boolean {
  if(rule?.muted || !item.price || !item.price.currency) return false;
  if(rule?.mode==='target') return item.price.currency===rule.currency && item.price.finalMinor<=rule.targetMinor!;
  return item.onSale===true && item.price.discountPercent>=(rule?.mode==='percent'?rule.percent!:global);
}
export function filteredAssistantItems(data:AssistantViewData,view:AssistantView):WishlistItem[] {
  return data.items.filter(item=>item.name.toLocaleLowerCase(data.config.language).includes(view.query.toLocaleLowerCase(data.config.language))
    && (!view.eligibleOnly || matchesRule(item,data.rules.get(item.appId),data.config.minimumDiscountPercent)));
}
export function buildAssistantView(data:AssistantViewData,view:AssistantView,session:string,disabled=false):ContainerBuilder {
  const tr=data.config.language==='tr', lang=data.config.language, prefix='assistant:'+session+':';
  const root=new ContainerBuilder().setAccentColor(dealioBrand.colors.primary);
  const add=(value:string)=>root.addTextDisplayComponents(text(value));
  const price=(minor:number,currency:string)=>formatMinorPrice(minor,currency,lang);
  const title={wishlist:tr?'İsteklerin. Senin kuralların.':'Your wishlist. Your rules.',
    detail:tr?'Oyuna yakından bak':'A closer look',history:tr?'Bildirim günlüğün':'Your alert history',
    rhythm:tr?'Sana uyan bildirimler':'Alerts on your terms'}[view.screen];
  add('-# DEALIO / '+(tr?'KİŞİSEL STEAM ASİSTANIN':'YOUR PERSONAL STEAM ASSISTANT'));
  add('# '+title);
  if(view.notice) add('> '+escapeMarkdown(view.notice).slice(0,250));
  if(view.screen==='wishlist'){
    const items=filteredAssistantItems(data,view), pages=Math.max(1,Math.ceil(items.length/3));
    const page=Math.min(Math.max(0,view.page),pages-1), visible=items.slice(page*3,page*3+3);
    const count=data.items.filter(i=>matchesRule(i,data.rules.get(i.appId),data.config.minimumDiscountPercent)).length;
    add(tr?`**${count} uygun fırsat** · ${data.items.length} oyun · ${data.config.storeCountryCode}`:
      `**${count} matching deals** · ${data.items.length} games · ${data.config.storeCountryCode}`);
    add((tr?'-# Kayıtlı liste · Fiyat verisi: ':'-# Saved wishlist · Price data: ')+
      `<t:${Math.floor(Date.parse(data.items.map(i=>i.priceObservedAt??data.capturedAt).sort()[0]??data.capturedAt)/1000)}:R>`+
      (view.refreshing?(tr?' · Steam’den yenileniyor…':' · Refreshing from Steam…'):''));
    if(view.query) add((tr?'Arama: ':'Search: ')+escapeMarkdown(view.query));
    for(const item of visible){
      const rule=data.rules.get(item.appId), p=item.price;
      const current=p?.currency?price(p.finalMinor,p.currency):(tr?'Fiyat doğrulanamadı':'Price unavailable');
      const ruleText=rule?.muted?(tr?'Susturuldu':'Muted'):rule?.mode==='target'?
        (tr?'Hedef: ':'Target: ')+price(rule.targetMinor!,rule.currency!):
        (tr?'En az %':'Minimum ')+(rule?.mode==='percent'?rule.percent:data.config.minimumDiscountPercent)+(tr?'':'%');
      root.addSectionComponents(artworkAccessory(new SectionBuilder().addTextDisplayComponents(text(
        `### ${escapeMarkdown(item.name).slice(0,100)}\n**${current}**${item.onSale?' · −'+p?.discountPercent+'%':''}\n-# ${ruleText}${matchesRule(item,rule,data.config.minimumDiscountPercent)?(tr?' · Kuralına uygun':' · Matches your rule'):''}`)), item));
    }
    if(!visible.length) add(tr?'Bu görünümde oyun yok. Aramayı veya filtreyi temizleyebilirsin.':'No games here. Clear the search or filter.');
    if(visible.length) root.addActionRowComponents(new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
      new StringSelectMenuBuilder().setCustomId(prefix+'game').setPlaceholder(tr?'Oyunu aç · hedef ve fiyat geçmişi':'Open game · target and price history')
        .setDisabled(disabled).addOptions(visible.map(i=>({label:i.name.slice(0,100),value:String(i.appId)})))));
    root.addActionRowComponents(new ActionRowBuilder<ButtonBuilder>().addComponents(
      button(prefix+'search',tr?'Oyun ara':'Search'),button(prefix+'filter',view.eligibleOnly?(tr?'Tüm oyunlar':'All games'):(tr?'Uygun fırsatlar':'Matching deals')),
      button(prefix+'refresh',tr?'Yenile':'Refresh').setDisabled(disabled||view.refreshing===true)));
    root.addActionRowComponents(new ActionRowBuilder<ButtonBuilder>().addComponents(
      button(prefix+'prev','‹').setDisabled(disabled||page===0),button(prefix+'page',`${page+1} / ${pages}`).setDisabled(true),
      button(prefix+'next','›').setDisabled(disabled||page===pages-1)));
  } else if(view.screen==='detail'){
    const item=data.items.find(i=>i.appId===view.selectedAppId);
    if(!item) add(tr?'Oyun kayıtlı listede bulunamadı.':'Game not found in the saved wishlist.');
    else{
      const p=item.price,rule=data.rules.get(item.appId);
      addArtwork(root, item);
      add('## '+escapeMarkdown(item.name).slice(0,120));
      add(p?.currency? '**'+price(p.finalMinor,p.currency)+'**'+(item.onSale?' · −'+p.discountPercent+'%':''):(tr?'Fiyat doğrulanamadı':'Price unavailable'));
      add((tr?'-# Steam fiyatı alındı: ':'-# Steam price fetched: ')+`<t:${Math.floor(Date.parse(item.priceObservedAt??data.capturedAt)/1000)}:R>`);
      const eligible=matchesRule(item,rule,data.config.minimumDiscountPercent);
      add(eligible?(tr?'🟢 Mevcut fiyat kuralına uygun. Kural kaydında ayrıca başlangıç DM’i gönderilmez.':'🟢 The current price matches your rule. Saving a rule does not send an initial DM.'):
        (tr?'Hedefe ulaşınca haber vereceğiz.':'We will notify you when your rule is met.'));
      if(rule?.mode==='target') add((tr?'Hedef fiyat: ':'Target price: ')+price(rule.targetMinor!,rule.currency!)+
        (p?.currency!==rule.currency?(tr?' · Para birimi değişmiş; hedefi yeniden kaydet.':' · Currency changed; save a new target.'):''));
      const history=data.priceHistory;
      if(history&&p?.currency){
        add('### '+(tr?'Steam fiyat geçmişi':'Steam price history'));
        if(history.status==='loading') add(tr?'Fiyat geçmişi yükleniyor…':'Loading price history…');
        else if(!history.history) add(tr?'Fiyat geçmişi şu anda alınamadı.':'Price history is unavailable right now.');
        else {
          const low=history.history.low&&historicalLowLine(p.finalMinor,p.currency,history.history.low,lang);
          add(low??(tr?'Bu bölge için Steam fiyat geçmişi bulunamadı.':'No Steam price history for this region yet.'));
          if(history.history.recent.length) add((tr?'**Son fiyat değişiklikleri**\n':'**Recent price changes**\n')+
            history.history.recent.map(change=>priceChangeLine(change,lang)).join('\n'));
          add(priceHistoryCredit(lang));
        }
      }
      root.addActionRowComponents(new ActionRowBuilder<ButtonBuilder>().addComponents(
        button(prefix+'inherit',tr?'Genel ayarı kullan':'Use global rule'),button(prefix+'percent',tr?'İndirim yüzdesi':'Discount %'),
        button(prefix+'target',tr?'Hedef fiyat':'Target price',true).setDisabled(disabled||!p?.currency)));
      root.addActionRowComponents(new ActionRowBuilder<ButtonBuilder>().addComponents(
        button(prefix+'wishlist','‹ '+(tr?'Listeye dön':'Back to list')),
        button(prefix+'mute',rule?.muted?(tr?'Sesi aç':'Unmute'):(tr?'Oyunu sustur':'Mute game'))));
      root.addActionRowComponents(new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder().setStyle(ButtonStyle.Link).setURL('https://store.steampowered.com/app/'+item.appId).setEmoji('🛒').setLabel(tr?'Steam’de aç':'Open on Steam')));
    }
  } else if(view.screen==='history'){
    add(tr?'Son 30 gün. “Discord’a iletildi”, mesajın okunduğu anlamına gelmez.':'Last 30 days. “Delivered to Discord” does not mean read.');
    const start=Math.max(0,view.page)*5, entries=data.history.slice(start,start+5);
    for(const h of entries){
      const label=h.status==='sent'?(tr?'Discord’a iletildi':'Delivered to Discord'):
        h.status==='expired'?(tr?'Geçerliliğini kaybetti':'Expired'):
        h.status==='blocked'?(tr?'DM engellendi':'DM blocked'):h.status==='terminal_failed'?(tr?'İletilemedi':'Failed'):(tr?'Bekliyor':'Pending');
      const why=h.reason.startsWith('target:')?(tr?'Hedef fiyatına ulaştı':'Your target price was reached'):(tr?'İndirim eşiğini karşıladı':'Your discount threshold was met');
      add(`**${escapeMarkdown(h.game_name).slice(0,100)}** · ${label}\n${why} · <t:${Math.floor(Date.parse(h.created_at)/1000)}:R>`);
    }
    if(!entries.length) add(tr?'Henüz bildirim kaydı yok.':'No alerts yet.');
    root.addActionRowComponents(new ActionRowBuilder<ButtonBuilder>().addComponents(button(prefix+'rhythm','‹ '+(tr?'Bildirim zamanı':'Alert timing')),
      button(prefix+'prev','‹').setDisabled(disabled||view.page===0),
      button(prefix+'next','›').setDisabled(disabled||start+5>=data.history.length),button(prefix+'retry',tr?'DM erişimini dene':'Retry DM access')));
  }else{
    const p=data.preference, zone=effectiveTimezone(data);
    const current=p.mode==='quiet'?`🌙 ${tr?'Rahatsız etme':'Do not disturb'} · ${clock(p.quietStart)}–${clock(p.quietEnd)}`
      :p.mode==='digest'?`📬 ${tr?'Günlük özet':'Daily digest'} · ${clock(p.digestMinute)}`
      :`⚡ ${tr?'Hemen':'Right away'}`;
    add((tr?'Şu an: ':'Now: ')+'**'+current+'**\n🌍 '+(tr?'Saat dilimi: ':'Time zone: ')+
      (zone?timezoneLabel(zone):(tr?'seçilmedi, aşağıdan seç':'not set, choose below')));
    add([
      tr?'⚡ **Hemen:** İndirim bulununca hemen DM gelir.':'⚡ **Right away:** a DM as soon as a deal is found.',
      tr?'🌙 **Rahatsız etme saatleri:** Bu saatlerde bildirim gelmez; saat bitince bekleyenler gelir.':'🌙 **Do not disturb:** no alerts during these hours; waiting alerts arrive when they end.',
      tr?'📬 **Günlük özet:** Günde bir kez, seçtiğin saatte tek mesaj.':'📬 **Daily digest:** one message a day at the time you choose.',
    ].join('\n'));
    root.addActionRowComponents(new ActionRowBuilder<ButtonBuilder>().addComponents(
      button(prefix+'instant','⚡ '+(tr?'Hemen':'Right away'),p.mode==='instant'),
      button(prefix+'quiet-night','🌙 '+(tr?'Gece 23:00–08:00':'Night 23:00–08:00'),p.mode==='quiet'),
      button(prefix+'digest-evening','📬 '+(tr?'Her akşam 19:00':'Every evening 19:00'),p.mode==='digest')));
    root.addActionRowComponents(new ActionRowBuilder<ButtonBuilder>().addComponents(
      button(prefix+'quiet','🕐 '+(tr?'Kendi saatlerim':'My own hours')),
      button(prefix+'digest','🕐 '+(tr?'Kendi özet saatim':'My digest time')),
      button(prefix+'history','📜 '+(tr?'Bildirim geçmişi':'Alert history'))));
    root.addActionRowComponents(new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
      new StringSelectMenuBuilder().setCustomId(prefix+'timezone').setDisabled(disabled)
        .setPlaceholder('🌍 '+(tr?'Saat dilimini değiştir':'Change time zone'))
        .addOptions(timezoneChoices(data.config.storeCountryCode,zone).map(choice=>({
          label:timezoneLabel(choice),value:choice,default:choice===zone})))));
    add(tr?'-# Kontroller yaklaşık 30 dakikada bir yapılır. Bekleyen bildirimlerin fiyatı göndermeden önce yeniden doğrulanır.'
      :'-# Checks run about every 30 minutes. Waiting alerts are re-checked before they are sent.');
  }
  const games=view.screen==='wishlist'||view.screen==='detail';
  root.addActionRowComponents(buildTabBar('assistant',session,lang,{active:games?'games':'alerts',
    activeIsRoot:view.screen==='wishlist'||view.screen==='rhythm',disabled}));
  if(disabled) for(const c of root.components) if(c instanceof ActionRowBuilder) for(const control of c.components)
    if('setDisabled' in control) control.setDisabled(true);
  add('-# '+(tr?'Açık beta · Fiyatlar Steam mağaza para birimindedir.':'Open beta · Prices use your Steam store currency.'));
  assertComponentsV2Limit([root]);
  return root;
}
