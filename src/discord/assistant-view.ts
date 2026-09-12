
import { ActionRowBuilder, ButtonBuilder, ButtonStyle, ContainerBuilder, MediaGalleryBuilder, MediaGalleryItemBuilder,
  SectionBuilder, StringSelectMenuBuilder, TextDisplayBuilder, ThumbnailBuilder, escapeMarkdown } from 'discord.js';
import type { WishlistItem } from '../domain/steam.js';
import type { UserConfig } from '../domain/user-config.js';
import type { GameRule, HistoryEntry, PricePoint } from '../persistence/assistant-repository.js';
import type { NotificationPreference } from '../domain/notification-preference.js';
import { formatMinorPrice } from './notification-messages.js';
import { assertComponentsV2Limit } from './ui/components-v2.js';
import { dealioBrand } from './ui/brand.js';

export interface AssistantView {
  screen:'wishlist'|'detail'|'history'|'rhythm'; page:number; query:string; eligibleOnly:boolean;
  selectedAppId?:number; notice?:string; refreshing?:boolean;
}
export interface AssistantViewData {
  config:UserConfig; items:readonly WishlistItem[]; capturedAt:string;
  rules:ReadonlyMap<number,GameRule>; preference:NotificationPreference; history:HistoryEntry[]; prices:PricePoint[];
}
const text=(value:string)=>new TextDisplayBuilder().setContent(value);
const button=(id:string,label:string,primary=false)=>new ButtonBuilder().setCustomId(id).setLabel(label).setStyle(primary?ButtonStyle.Primary:ButtonStyle.Secondary);
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
      root.addSectionComponents(new SectionBuilder().addTextDisplayComponents(text(
        `### ${escapeMarkdown(item.name).slice(0,100)}\n**${current}**${item.onSale?' · −'+p?.discountPercent+'%':''}\n-# ${ruleText}${matchesRule(item,rule,data.config.minimumDiscountPercent)?(tr?' · Kuralına uygun':' · Matches your rule'):''}`))
        .setThumbnailAccessory(new ThumbnailBuilder().setURL(`https://cdn.akamai.steamstatic.com/steam/apps/${item.appId}/header.jpg`).setDescription(item.name.slice(0,100))));
    }
    if(!visible.length) add(tr?'Bu görünümde oyun yok. Aramayı veya filtreyi temizleyebilirsin.':'No games here. Clear the search or filter.');
    if(visible.length) root.addActionRowComponents(new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
      new StringSelectMenuBuilder().setCustomId(prefix+'game').setPlaceholder(tr?'Oyunu aç · hedef ve fiyat geçmişi':'Open game · target and price history')
        .setDisabled(disabled).addOptions(visible.map(i=>({label:i.name.slice(0,100),value:String(i.appId)})))));
    root.addActionRowComponents(new ActionRowBuilder<ButtonBuilder>().addComponents(
      button(prefix+'search',tr?'Oyun ara':'Search'),button(prefix+'filter',view.eligibleOnly?(tr?'Tüm oyunlar':'All games'):(tr?'Uygun fırsatlar':'Matching deals')),
      button(prefix+'refresh',tr?'Yenile':'Refresh')));
    root.addActionRowComponents(new ActionRowBuilder<ButtonBuilder>().addComponents(
      button(prefix+'prev','‹').setDisabled(disabled||page===0),button(prefix+'page',`${page+1} / ${pages}`).setDisabled(true),
      button(prefix+'next','›').setDisabled(disabled||page===pages-1)));
  } else if(view.screen==='detail'){
    const item=data.items.find(i=>i.appId===view.selectedAppId);
    if(!item) add(tr?'Oyun kayıtlı listede bulunamadı.':'Game not found in the saved wishlist.');
    else{
      const p=item.price,rule=data.rules.get(item.appId);
      root.addMediaGalleryComponents(new MediaGalleryBuilder().addItems(new MediaGalleryItemBuilder()
        .setURL(`https://cdn.akamai.steamstatic.com/steam/apps/${item.appId}/header.jpg`).setDescription(item.name.slice(0,100))));
      add('## '+escapeMarkdown(item.name).slice(0,120));
      add(p?.currency? '**'+price(p.finalMinor,p.currency)+'**'+(item.onSale?' · −'+p.discountPercent+'%':''):(tr?'Fiyat doğrulanamadı':'Price unavailable'));
      add((tr?'-# Fiyat gözlemi: ':'-# Price observed: ')+`<t:${Math.floor(Date.parse(item.priceObservedAt??data.capturedAt)/1000)}:R>`);
      const eligible=matchesRule(item,rule,data.config.minimumDiscountPercent);
      add(eligible?(tr?'🟢 Mevcut fiyat kuralına uygun. Kural kaydında ayrıca başlangıç DM’i gönderilmez.':'🟢 The current price matches your rule. Saving a rule does not send an initial DM.'):
        (tr?'Hedefe ulaşınca haber vereceğiz.':'We will notify you when your rule is met.'));
      if(rule?.mode==='target') add((tr?'Hedef fiyat: ':'Target price: ')+price(rule.targetMinor!,rule.currency!)+
        (p?.currency!==rule.currency?(tr?' · Para birimi değişmiş; hedefi yeniden kaydet.':' · Currency changed; save a new target.'):''));
      const points=data.prices;
      add('### '+(tr?'Son 90 gün · Dealio gözlemleri':'Last 90 days · Dealio observations'));
      if(points.length<2) add(tr?'Henüz karşılaştırma için yeterli gözlem yok. Takip öncesindeki fiyatları bilmiyoruz.':'Not enough observations to compare yet. Prices before tracking are unknown.');
      else {
        const low=Math.min(...points.map(x=>x.final_minor));
        add((tr?'Gözlemlediğimiz en düşük: ':'Lowest observed: ')+price(low,p!.currency!)+
          `\n-# ${points.length} ${tr?'fiyat kaydı; tüm zamanların en düşüğü değildir.':'price records; not an all-time low.'}`);
        add(points.slice(-5).map(x=>`<t:${Math.floor(Date.parse(x.observed_at)/1000)}:d> · **${price(x.final_minor,p!.currency!)}**`).join('\n'));
      }
      root.addActionRowComponents(new ActionRowBuilder<ButtonBuilder>().addComponents(
        button(prefix+'inherit',tr?'Genel ayarı kullan':'Use global rule'),button(prefix+'percent',tr?'İndirim yüzdesi':'Discount %'),
        button(prefix+'target',tr?'Hedef fiyat':'Target price',true).setDisabled(disabled||!p?.currency)));
      root.addActionRowComponents(new ActionRowBuilder<ButtonBuilder>().addComponents(
        button(prefix+'mute',rule?.muted?(tr?'Sesi aç':'Unmute'):(tr?'Oyunu sustur':'Mute game')),
        new ButtonBuilder().setStyle(ButtonStyle.Link).setURL('https://store.steampowered.com/app/'+item.appId).setLabel(tr?'Steam’de aç':'Open on Steam')));
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
    root.addActionRowComponents(new ActionRowBuilder<ButtonBuilder>().addComponents(button(prefix+'prev','‹').setDisabled(disabled||view.page===0),
      button(prefix+'next','›').setDisabled(disabled||start+5>=data.history.length),button(prefix+'retry',tr?'DM erişimini dene':'Retry DM access')));
  }else{
    const p=data.preference;
    const mode=p.mode==='instant'?(tr?'Tespit edilince':'When detected'):p.mode==='quiet'?(tr?'Sessiz saatler':'Quiet hours'):(tr?'Günlük özet':'Daily digest');
    add('## '+mode);
    const time=(m:number|null)=>m===null?'—':String(Math.floor(m/60)).padStart(2,'0')+':'+String(m%60).padStart(2,'0');
    add((tr?'Saat dilimi: ':'Timezone: ')+(p.timezone??(tr?'Seçilmedi':'Not selected')));
    if(p.mode==='quiet') add(time(p.quietStart)+' → '+time(p.quietEnd));
    if(p.mode==='digest') add((tr?'Özet saati: ':'Digest time: ')+time(p.digestMinute));
    add(tr?'Kontroller 30 dakikada bir yapılır. Sessiz saatlerde bildirimler bekler; iletilmeden önce fiyat tekrar doğrulanır.':'Checks run every 30 minutes. Alerts wait during quiet hours; prices are revalidated before delivery.');
    root.addActionRowComponents(new ActionRowBuilder<ButtonBuilder>().addComponents(
      button(prefix+'instant',tr?'Tespit edilince':'When detected'),button(prefix+'quiet',tr?'Sessiz saatler':'Quiet hours'),
      button(prefix+'digest',tr?'Günlük özet':'Daily digest')));
  }
  root.addActionRowComponents(new ActionRowBuilder<ButtonBuilder>().addComponents(
    button(prefix+'wishlist',tr?'Wishlist':'Wishlist'),button(prefix+'history',tr?'Geçmiş':'History'),button(prefix+'rhythm',tr?'Bildirim ritmi':'Alert timing')));
  if(disabled) for(const c of root.components) if(c instanceof ActionRowBuilder) for(const control of c.components)
    if('setDisabled' in control) control.setDisabled(true);
  add('-# '+(tr?'Açık beta · Fiyatlar Steam mağaza para birimindedir.':'Open beta · Prices use your Steam store currency.'));
  assertComponentsV2Limit([root]);
  return root;
}
