# Dealio destek sunucusu

Destek sunucusu, App Directory (Discovery) ve top.gg için gereken "support server"
bağlantısıdır. Kanalları, rolleri, izinleri, kuralları, SSS'yi ve ticket panelini
`npm run support:setup` kurar. Ticket'ları Dealio'nun kendisi açar: her ticket, ticket
kanalında yalnızca kullanıcının ve ekibin gördüğü özel bir thread olur.

## Kurulum

1. **Boş sunucuyu aç.** Discord → **+** → *Kendim oluştur* → *Kendim ve arkadaşlarım için*.
   Adı önemli değil; betik onu `Dealio Support` yapar. (10'dan fazla sunucudaki botlar
   sunucu oluşturamaz, bu adımı yalnızca sen yapabilirsin.)
2. **Sunucu kimliğini al.** Ayarlar → Gelişmiş → *Geliştirici Modu* açık olsun; sunucu
   simgesine sağ tık → *Sunucu ID'sini kopyala*.
3. **Dealio'yu kurulum yetkisiyle ekle.** `<SUNUCU_ID>` yerine kimliği yaz:

   ```
   https://discord.com/oauth2/authorize?client_id=1540325119690412172&scope=bot%20applications.commands&permissions=360777370632&guild_id=<SUNUCU_ID>&disable_guild_select=true
   ```

   İzinler: ticket'ların çalışması için gerekenler (kanalı görme, mesaj, thread içinde
   mesaj, özel thread açma, thread yönetme, bağlantı ve dosya, mesaj geçmişi) ile
   kurulum boyunca **Yönetici**.
4. **Önce kuru çalıştır, sonra kur** (kendi bilgisayarında, `.env` içindeki Dealio
   token'ıyla; yalnızca REST çağrısı yapar, gateway'e bağlanmaz, VM'deki botla çakışmaz):

   ```
   npm run support:setup -- --guild <SUNUCU_ID> --dry-run
   npm run support:setup -- --guild <SUNUCU_ID>
   ```

   Betik sonunda üç kimlik ve kalıcı bir davet bağlantısı yazar.
5. **Yönetici yetkisini geri al.** Sunucu Ayarları → Roller → *Dealio* → **Yönetici**
   kutusunu kapat (diğerleri kalsın).
6. **Kendine rolleri ver:** `Dealio Team` ve `Support Team`. Ticket bildirimleri
   `Support Team` rolüne gider.
7. **VM'de ticket'ları aç.** Betiğin yazdığı üç satırı VM'deki `.env`'e ekle ve Dealio'yu
   yeniden başlat:

   ```
   DEALIO_SUPPORT_GUILD_ID=...
   DEALIO_SUPPORT_LOG_CHANNEL_ID=...
   DEALIO_SUPPORT_TEAM_ROLE_ID=...
   ```

   Bu üçü yokken ticket butonu "Ticket'lar destek sunucusunda açılır" der ve hiçbir şey açmaz.
8. **Developer Portal → Discovery.** *Support server* alanına sunucuyu seç ya da davet
   bağlantısını gir. Discovery için ekip sahibinin kimlik doğrulaması da gerekir.

Betiği istediğin zaman yeniden çalıştırabilirsin: her şeyi adıyla bulur, kopya
oluşturmaz, metinleri ve izinleri günceller. Bunun için 3. adımdaki gibi Yönetici
yetkisini geçici olarak yeniden vermen gerekir.

## Sunucunun yapısı

| Kategori | Kanal | Kim yazabilir |
| --- | --- | --- |
| 📌 Start Here | 👋・welcome, 📜・rules, 📣・announcements (duyuru kanalı, takip edilebilir), ❓・faq | Ekip ve Dealio |
| 💬 Community | 💬・general, 🔥・deals (30 sn yavaş mod), 💡・suggestions (forum, durum etiketleri) | Herkes |
| 🎫 Support | 🎫・open-a-ticket | Kimse; üyeler yalnızca kendi ticket thread'lerine yazar |
| 🔒 Staff | 📋・ticket-log, 🛡️・staff-chat, 🔔・discord-updates | Yalnızca ekip |

- **Community** açık (App Directory'deki destek sunucusu için şart); doğrulama seviyesi
  *Orta*, medya filtresi tüm üyeler, bildirimler yalnızca @bahsetme.
- **Karşılama ekranı** yeni üyelere kurallar, SSS, ticket, duyurular ve fırsatlar kanalını gösterir.
- **AutoMod**: spam, toplu etiketleme (10 dk susturma), cinsel içerik ve hakaretler,
  sunucu davet bağlantıları (ekip hariç). Uyarılar `staff-chat`'e düşer.
- Üyeler thread açamaz ve @everyone kullanamaz.

## Ticket'lar nasıl çalışır

- `open-a-ticket` kanalındaki **Ticket aç** butonu bir form açar: konu (kurulum,
  bildirimler, hata, hesap, diğer) ve açıklama. Form ve tüm mesajlar kullanıcının
  Dealio diline, yoksa Discord diline göre TR/EN/DE/FR olur.
- Dealio kanalda `#0042 · Bug report · kullanıcı` adlı, davet edilemeyen özel bir thread
  açar, kullanıcıyı ekler, açıklamayı ve **Ticket'ı kapat** butonunu gönderir.
  `ticket-log` kanalına bir satır yazar ve `Support Team` rolünü etiketler.
- `Support Team` ve `Dealio Team` ticket kanalında *Thread'leri Yönet* yetkisine sahip
  olduğu için bütün özel thread'leri görür ve yazabilir.
- Kullanıcı başına aynı anda bir açık ticket ve 24 saatte üç ticket hakkı vardır.
  Bir hafta sessiz kalan thread'i Discord arşivler; kullanıcı oraya yazınca yeniden açılır.
- Ticket'ı açan kişi ya da ekip kapatabilir. Dealio bir kapanış mesajı yazar, thread'i
  arşivleyip kilitler ve `ticket-log`'a kaydeder. Kilitli bir ticket'ı yalnızca ekip açabilir.
- Veritabanında yalnızca ticket'ın künyesi tutulur (numara, kullanıcı, konu, thread,
  durum, zamanlar). Konuşma Discord'da kalır. Kayıtlar kapanıştan 90 gün sonra silinir;
  `/delete-data` bunları da siler. Bu durum gizlilik politikasında yazılıdır.
