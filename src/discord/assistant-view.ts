import { artworkAccessory, addArtwork } from './ui/game-artwork.js';

import { ActionRowBuilder, ButtonBuilder, ButtonStyle, ContainerBuilder, SectionBuilder, SeparatorBuilder,
  SeparatorSpacingSize, StringSelectMenuBuilder, TextDisplayBuilder, escapeMarkdown } from 'discord.js';
import type { WishlistItem } from '../domain/steam.js';
import type { UserConfig } from '../domain/user-config.js';
import type { GameRule, HistoryEntry } from '../persistence/assistant-repository.js';
import type { NotificationPreference } from '../domain/notification-preference.js';
import type { GameHistory } from '../domain/price-history.js';
import { formatMinorPrice } from './notification-messages.js';
import { historicalLowLine, priceChangeLine, priceHistoryCredit } from './price-history-text.js';
import { assertComponentsV2Limit, dealioFooter } from './ui/components-v2.js';
import { flagEmoji, panelHeader, priceLine, savingsLine, tabAccent } from './ui/design.js';
import { buildTabBar } from './ui/tab-bar.js';
import { defaultTimezone, timezoneChoices, timezoneLabel } from '../domain/timezone.js';

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
const button=(id:string,label:string,emoji?:string,primary=false)=>{
  const control=new ButtonBuilder().setCustomId(id).setLabel(label).setStyle(primary?ButtonStyle.Primary:ButtonStyle.Secondary);
  return emoji?control.setEmoji(emoji):control;
};
/** The saved time zone, else the Store region's own zone; null when the user must choose. */
export function effectiveTimezone(data:Pick<AssistantViewData,'preference'|'config'>):string|null {
  return data.preference.timezone??defaultTimezone(data.config.storeCountryCode);
}
const clock=(minute:number|null)=>minute===null?'—':String(Math.floor(minute/60)).padStart(2,'0')+':'+String(minute%60).padStart(2,'0');
const relative=(value:string)=>`<t:${Math.floor(Date.parse(value)/1000)}:R>`;
export function matchesRule(item:WishlistItem,rule:GameRule|undefined,global:number):boolean {
  if(rule?.muted || !item.price || !item.price.currency) return false;
  if(rule?.mode==='target') return item.price.currency===rule.currency && item.price.finalMinor<=rule.targetMinor!;
  return item.onSale===true && item.price.discountPercent>=(rule?.mode==='percent'?rule.percent!:global);
}
export function filteredAssistantItems(data:AssistantViewData,view:AssistantView):WishlistItem[] {
  return data.items.filter(item=>item.name.toLocaleLowerCase(data.config.language).includes(view.query.toLocaleLowerCase(data.config.language))
    && (!view.eligibleOnly || matchesRule(item,data.rules.get(item.appId),data.config.minimumDiscountPercent)));
}
function pricedItem(item:WishlistItem){
  const p=item.price;
  return p?.currency?{finalMinor:p.finalMinor,initialMinor:p.initialMinor,discountPercent:p.discountPercent,currency:p.currency}:null;
}
export function buildAssistantView(data:AssistantViewData,view:AssistantView,session:string,disabled=false):ContainerBuilder {
  const tr=data.config.language==='tr', lang=data.config.language, prefix='assistant:'+session+':';
  const games=view.screen==='wishlist'||view.screen==='detail';
  const root=new ContainerBuilder().setAccentColor(tabAccent[games?'games':'alerts']);
  const add=(value:string)=>root.addTextDisplayComponents(text(value));
  const gap=()=>root.addSeparatorComponents(new SeparatorBuilder().setDivider(false).setSpacing(SeparatorSpacingSize.Small));
  const divider=()=>root.addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small));
  const price=(minor:number,currency:string)=>formatMinorPrice(minor,currency,lang);
  const ruleText=(rule:GameRule|undefined)=>rule?.muted?'🔕 '+(tr?'Susturuldu':'Muted')
    :rule?.mode==='target'?'🎯 '+(tr?'Hedef ':'Target ')+price(rule.targetMinor!,rule.currency!)
    :'🏷️ '+(tr?'En az %':'At least ')+(rule?.mode==='percent'?rule.percent:data.config.minimumDiscountPercent)+(tr?' indirim':'% off')
      +(rule?.mode==='percent'?'':(tr?' (genel)':' (global)'));
  const notice=()=>{if(view.notice) add('> '+escapeMarkdown(view.notice).slice(0,250));};

  if(view.screen==='wishlist'){
    const items=filteredAssistantItems(data,view), pages=Math.max(1,Math.ceil(items.length/3));
    const page=Math.min(Math.max(0,view.page),pages-1), visible=items.slice(page*3,page*3+3);
    const count=data.items.filter(i=>matchesRule(i,data.rules.get(i.appId),data.config.minimumDiscountPercent)).length;
    add(panelHeader('games',lang,tr?'Oyunların ve hedeflerin':'Your games & targets',
      `✅ **${count}** ${tr?'uygun fırsat':'matching deals'}　🎮 **${data.items.length}** ${tr?'oyun':'games'}　${flagEmoji(data.config.storeCountryCode)} ${data.config.storeCountryCode}`)+
      '\n-# 🕒 '+(tr?'Fiyatlar ':'Prices ')+relative(data.items.map(i=>i.priceObservedAt??data.capturedAt).sort()[0]??data.capturedAt)+
      (view.refreshing?(tr?' · Steam’den yenileniyor…':' · Refreshing from Steam…'):''));
    notice();
    if(view.query) add('🔍 '+(tr?'Arama: ':'Search: ')+'**'+escapeMarkdown(view.query)+'**');
    divider();
    visible.forEach((item,index)=>{
      if(index>0) gap();
      const rule=data.rules.get(item.appId), p=pricedItem(item);
      const matches=matchesRule(item,rule,data.config.minimumDiscountPercent);
      root.addSectionComponents(artworkAccessory(new SectionBuilder().addTextDisplayComponents(text(
        `### ${matches?'🔥 ':''}${escapeMarkdown(item.name).slice(0,100)}\n${p?priceLine(p,lang):(tr?'Fiyat doğrulanamadı':'Price unavailable')}\n`+
        `-# ${ruleText(rule)}${matches?(tr?' · ✅ Kuralına uygun':' · ✅ Matches your rule'):''}`)), item));
    });
    if(!visible.length) add('🫥 '+(tr?'Bu görünümde oyun yok. Aramayı veya filtreyi temizleyebilirsin.':'No games here. Clear the search or filter.'));
    divider();
    if(visible.length) root.addActionRowComponents(new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
      new StringSelectMenuBuilder().setCustomId(prefix+'game').setPlaceholder('🎮 '+(tr?'Bir oyun aç · hedef ve fiyat geçmişi':'Open a game · target and price history'))
        .setDisabled(disabled).addOptions(visible.map(item=>{
          const p=pricedItem(item);
          return {label:item.name.slice(0,100),value:String(item.appId),
            emoji:matchesRule(item,data.rules.get(item.appId),data.config.minimumDiscountPercent)?'🔥':'🎮',
            ...(p?{description:(price(p.finalMinor,p.currency)+(p.discountPercent>0?(tr?` · %${p.discountPercent} indirim`:` · ${p.discountPercent}% off`):'')).slice(0,100)}:{})};
        }))));
    root.addActionRowComponents(new ActionRowBuilder<ButtonBuilder>().addComponents(
      button(prefix+'search',tr?'Oyun ara':'Search','🔍'),
      button(prefix+'filter',view.eligibleOnly?(tr?'Tüm oyunlar':'All games'):(tr?'Uygun fırsatlar':'Matching deals'),view.eligibleOnly?'📋':'✅'),
      button(prefix+'refresh',tr?'Yenile':'Refresh','🔄').setDisabled(disabled||view.refreshing===true)));
    if(pages>1) root.addActionRowComponents(new ActionRowBuilder<ButtonBuilder>().addComponents(
      button(prefix+'prev',tr?'Önceki':'Previous','◀️').setDisabled(disabled||page===0),
      button(prefix+'page',`${page+1} / ${pages}`).setDisabled(true),
      button(prefix+'next',tr?'Sonraki':'Next','▶️').setDisabled(disabled||page===pages-1)));
  } else if(view.screen==='detail'){
    const item=data.items.find(i=>i.appId===view.selectedAppId);
    if(!item){
      add(panelHeader('games',lang,tr?'Oyun bulunamadı':'Game not found',
        tr?'Oyun kayıtlı listede yok. Listeye dönüp yenileyebilirsin.':'The game is not in the saved wishlist. Go back and refresh.'));
      root.addActionRowComponents(new ActionRowBuilder<ButtonBuilder>().addComponents(button(prefix+'wishlist',tr?'Listeye dön':'Back to list','◀️')));
    } else{
      const p=pricedItem(item),rule=data.rules.get(item.appId);
      add('-# 🎮 DEALIO · '+(tr?'OYUNLARIM':'MY GAMES'));
      addArtwork(root, item);
      const savings=p&&savingsLine(p,lang);
      add('# '+escapeMarkdown(item.name).slice(0,120)+'\n'+(p?priceLine(p,lang):(tr?'Fiyat doğrulanamadı':'Price unavailable'))+
        (savings?'\n'+savings:'')+'\n-# 🕒 '+(tr?'Steam fiyatı alındı: ':'Steam price fetched: ')+relative(item.priceObservedAt??data.capturedAt));
      notice();
      divider();
      const eligible=matchesRule(item,rule,data.config.minimumDiscountPercent);
      add('### 🎯 '+(tr?'Kuralın':'Your rule')+'\n'+ruleText(rule)+
        (rule?.mode==='target'&&p?.currency!==rule.currency?(tr?' · ⚠️ Para birimi değişmiş; hedefi yeniden kaydet.':' · ⚠️ Currency changed; save a new target.'):'')+'\n'+
        (eligible?(tr?'🟢 Şu anki fiyat kuralına uygun. Kural kaydı ayrıca DM göndermez.':'🟢 The current price matches your rule. Saving a rule does not send an initial DM.')
          :(tr?'⏳ Kuralına uyan bir fiyat gelince DM ile haber vereceğiz.':'⏳ We will DM you when a price meets your rule.')));
      root.addActionRowComponents(new ActionRowBuilder<ButtonBuilder>().addComponents(
        button(prefix+'inherit',tr?'Genel kural':'Global rule','♻️'),
        button(prefix+'percent',tr?'İndirim yüzdesi':'Discount %','🏷️'),
        button(prefix+'target',tr?'Hedef fiyat':'Target price','🎯',true).setDisabled(disabled||!p)));
      const history=data.priceHistory;
      if(history&&p){
        divider();
        add('### 📈 '+(tr?'Steam fiyat geçmişi':'Steam price history'));
        if(history.status==='loading') add('⏳ '+(tr?'Fiyat geçmişi yükleniyor…':'Loading price history…'));
        else if(!history.history) add('⚠️ '+(tr?'Fiyat geçmişi şu anda alınamadı.':'Price history is unavailable right now.'));
        else {
          const low=history.history.low&&historicalLowLine(p.finalMinor,p.currency,history.history.low,lang);
          add(low??('📭 '+(tr?'Bu bölge için Steam fiyat geçmişi bulunamadı.':'No Steam price history for this region yet.')));
          if(history.history.recent.length) add((tr?'**Son fiyat değişiklikleri**\n':'**Recent price changes**\n')+
            history.history.recent.map(change=>priceChangeLine(change,lang)).join('\n'));
          add(priceHistoryCredit(lang));
        }
      }
      divider();
      root.addActionRowComponents(new ActionRowBuilder<ButtonBuilder>().addComponents(
        button(prefix+'wishlist',tr?'Listeye dön':'Back to list','◀️'),
        button(prefix+'mute',rule?.muted?(tr?'Sesi aç':'Unmute'):(tr?'Oyunu sustur':'Mute game'),rule?.muted?'🔔':'🔕')));
      root.addActionRowComponents(new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder().setStyle(ButtonStyle.Link).setURL('https://store.steampowered.com/app/'+item.appId).setEmoji('🛒').setLabel(tr?'Steam’de aç':'Open on Steam')));
    }
  } else if(view.screen==='history'){
    add(panelHeader('alerts',lang,tr?'Bildirim geçmişin':'Your alert history',
      tr?'-# Son 30 gün. “Discord’a iletildi”, mesajın okunduğu anlamına gelmez.':'-# Last 30 days. “Delivered to Discord” does not mean read.'));
    notice();
    divider();
    const start=Math.max(0,view.page)*5, entries=data.history.slice(start,start+5);
    entries.forEach((h,index)=>{
      if(index>0) gap();
      const status=h.status==='sent'?['✅',tr?'Discord’a iletildi':'Delivered to Discord']:
        h.status==='expired'?['⌛',tr?'Geçerliliğini kaybetti':'Expired']:
        h.status==='blocked'?['🚫',tr?'DM engellendi':'DM blocked']:h.status==='terminal_failed'?['❌',tr?'İletilemedi':'Failed']:['⏳',tr?'Bekliyor':'Pending'];
      const why=h.reason.startsWith('target:')?'🎯 '+(tr?'Hedef fiyatına ulaştı':'Your target price was reached'):'🏷️ '+(tr?'İndirim eşiğini karşıladı':'Your discount threshold was met');
      add(`${status[0]} **${escapeMarkdown(h.game_name).slice(0,100)}**\n-# ${why} · ${status[1]} · ${relative(h.created_at)}`);
    });
    if(!entries.length) add('📭 '+(tr?'Henüz bildirim kaydı yok.':'No alerts yet.'));
    divider();
    root.addActionRowComponents(new ActionRowBuilder<ButtonBuilder>().addComponents(
      button(prefix+'rhythm',tr?'Bildirim zamanı':'Alert timing','◀️'),
      button(prefix+'prev',tr?'Önceki':'Previous').setDisabled(disabled||view.page===0),
      button(prefix+'next',tr?'Sonraki':'Next').setDisabled(disabled||start+5>=data.history.length),
      button(prefix+'retry',tr?'DM erişimini dene':'Retry DM access','✉️')));
  }else{
    const p=data.preference, zone=effectiveTimezone(data);
    const current=p.mode==='quiet'?`🌙 ${tr?'Rahatsız etme':'Do not disturb'} · ${clock(p.quietStart)}–${clock(p.quietEnd)}`
      :p.mode==='digest'?`📬 ${tr?'Günlük özet':'Daily digest'} · ${clock(p.digestMinute)}`
      :`⚡ ${tr?'Hemen':'Right away'}`;
    add(panelHeader('alerts',lang,tr?'Bildirimler sana uysun':'Alerts on your terms',
      (tr?'Şu an: ':'Now: ')+'**'+current+'**\n🌍 '+(tr?'Saat dilimi: ':'Time zone: ')+
      (zone?timezoneLabel(zone):(tr?'seçilmedi, aşağıdan seç':'not set, choose below'))));
    notice();
    divider();
    add([
      tr?'⚡ **Hemen:** İndirim bulununca hemen DM gelir.':'⚡ **Right away:** a DM as soon as a deal is found.',
      tr?'🌙 **Rahatsız etme saatleri:** Bu saatlerde bildirim gelmez; saat bitince bekleyenler gelir.':'🌙 **Do not disturb:** no alerts during these hours; waiting alerts arrive when they end.',
      tr?'📬 **Günlük özet:** Günde bir kez, seçtiğin saatte tek mesaj.':'📬 **Daily digest:** one message a day at the time you choose.',
    ].join('\n'));
    root.addActionRowComponents(new ActionRowBuilder<ButtonBuilder>().addComponents(
      button(prefix+'instant',tr?'Hemen':'Right away','⚡',p.mode==='instant'),
      button(prefix+'quiet-night',tr?'Gece 23:00–08:00':'Night 23:00–08:00','🌙',p.mode==='quiet'),
      button(prefix+'digest-evening',tr?'Her akşam 19:00':'Every evening 19:00','📬',p.mode==='digest')));
    root.addActionRowComponents(new ActionRowBuilder<ButtonBuilder>().addComponents(
      button(prefix+'quiet',tr?'Kendi saatlerim':'My own hours','🕐'),
      button(prefix+'digest',tr?'Kendi özet saatim':'My digest time','🕖'),
      button(prefix+'history',tr?'Bildirim geçmişi':'Alert history','📜')));
    root.addActionRowComponents(new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
      new StringSelectMenuBuilder().setCustomId(prefix+'timezone').setDisabled(disabled)
        .setPlaceholder('🌍 '+(tr?'Saat dilimini değiştir':'Change time zone'))
        .addOptions(timezoneChoices(data.config.storeCountryCode,zone).map(choice=>({
          label:timezoneLabel(choice),value:choice,default:choice===zone})))));
    add(tr?'-# Kontroller yaklaşık 30 dakikada bir yapılır. Bekleyen bildirimlerin fiyatı göndermeden önce yeniden doğrulanır.'
      :'-# Checks run about every 30 minutes. Waiting alerts are re-checked before they are sent.');
  }
  divider();
  root.addActionRowComponents(buildTabBar('assistant',session,lang,{active:games?'games':'alerts',
    activeIsRoot:view.screen==='wishlist'||view.screen==='rhythm',disabled}));
  if(disabled) for(const c of root.components) if(c instanceof ActionRowBuilder) for(const control of c.components)
    if('setDisabled' in control) control.setDisabled(true);
  add(dealioFooter(lang));
  assertComponentsV2Limit([root]);
  return root;
}
