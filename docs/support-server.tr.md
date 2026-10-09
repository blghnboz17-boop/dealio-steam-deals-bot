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
3. **Dealio'yu Yönetici yetkisiyle ekle.** Açılan sayfada "Sunucuya ekle" listesinden
   yeni sunucuyu seç:

   ```
   https://discord.com/oauth2/authorize?client_id=1540325119690412172&scope=bot%20applications.commands&permissions=360777370632&integration_type=0
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

   Betik sonunda üç kimlik ve kalıcı bir davet bağlantısı yazar. Kurulu sunucunun
   davet bağlantısı: https://discord.gg/GVEA3MReDy
5. **Roller.** Betik sunucu sahibine `👑 Owner` ve `🎧 Support Team` rollerini verir
   (ticket bildirimleri Support Team'e gider). Diğer rolleri Sunucu Ayarları → Üyeler'den
   dağıt. Dealio'nun Yönetici yetkisi kalabilir; betiği yeniden çalıştırmak için de gerekir.
6. **Booster rolü.** Discord'un `Server Booster` rolü ilk boost'ta oluşur. Sonra betiği
   bir kez daha çalıştır: rolü `💎 Server Booster` yapar, renklendirir ve lounge'a ekler.
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
oluşturmaz, metinleri, rolleri ve izinleri günceller (Dealio'nun Yönetici yetkisi gerekir).
Sunucu boost seviyesi 2'ye ulaşınca yeniden çalıştırmak rollere gradyan renk ve rol
simgesi ekler.

## Roller

| Rol | Yetki | Kim alır |
| --- | --- | --- |
| 👑 Owner | Yönetici | Sunucu sahibi (betik verir) |
| 🛡️ Admins | Yönetici | Güvendiğin yöneticiler |
| 🔨 Moderators | Mesaj/thread yönetimi, susturma, atma, yasaklama | Moderatörler |
| 🎧 Support Team | Mesaj/thread yönetimi, susturma; tüm ticket'ları görür | Ticket'lara bakanlar |
| 💎 Server Booster | Yok | Discord otomatik verir |
| 🌟 Legendary Donator | Yok | Toplam 10 kahve |
| 💖 Super Donator | Yok | Toplam 5 kahve |
| ☕ Donator | Yok | Herhangi bir kahve |
| 🔔 Updates | Yok (listede ayrı görünmez) | Onboarding'de "ping me" diyenler; duyurularda @everyone yerine bunu etiketle |

Donator rollerini sen elle verirsin: kullanıcı Buy Me a Coffee'deki adıyla ticket açar.
Kademeler `scripts/support-server/blueprint.ts` içindeki `donatorTiers` ve
`💝・support-dealio` mesajında yazılı; değiştirince betiği yeniden çalıştır.

## Sunucunun yapısı

| Kategori | Kanal | Kim yazabilir |
| --- | --- | --- |
| 📌 Start Here | 👋・welcome, 📜・rules, 📣・announcements (duyuru kanalı, takip edilebilir), ❓・faq, 💝・support-dealio | Ekip ve Dealio |
| 💬 Community | 💬・general, 🎮・off-topic, 🕹️・now-playing, 🔥・deals (30 sn yavaş mod), 🏆・deal-wins (galeri görünümlü forum), 💡・suggestions (forum, durum etiketleri), 🤖・try-dealio | Herkes |
| 💬 Community | 💖・supporters-lounge | Yalnızca Donator, Booster ve ekip |
| 🎫 Support | 🎫・open-a-ticket | Kimse; üyeler yalnızca kendi ticket thread'lerine yazar |
| 🔒 Staff | 📋・ticket-log, 🛡️・staff-chat, 🔔・discord-updates | Yalnızca ekip |

- **Community** açık (App Directory'deki destek sunucusu için şart); doğrulama seviyesi
  *Orta*, medya filtresi tüm üyeler, bildirimler yalnızca @bahsetme.
- **Karşılama ekranı** yeni üyelere kurallar, SSS, ticket, duyurular ve fırsatlar kanalını gösterir.
- **Onboarding** açık: 13 varsayılan kanal, "What brings you to Dealio?" sorusu (yeni üye,
  yardım, fırsatlar, öneriler; seçime göre kanallar) ve 🔔 Updates rolü için tercih.
  *Server Guide* (karşılama mesajı ve yapılacaklar listesi) Discord API'sinde yok;
  istersen Sunucu Ayarları → Onboarding → Server Guide'dan elle doldurabilirsin.
- **:dealio:** özel emojisi Dealio'nun avatarından oluşturulur.
- **Media kanalı** API ile oluşturulamıyor (Discord `50024` döndürüyor), bu yüzden
  `deal-wins` galeri görünümlü bir forum.
- **AutoMod**: spam, toplu etiketleme (10 dk susturma), cinsel içerik ve hakaretler,
  sunucu davet bağlantıları (ekip hariç) ve ekibi taklit eden profil adları ("Dealio Support"
  gibi; ad değişene kadar yazamaz). Uyarılar `staff-chat`'e düşer.
- Üyeler thread açamaz ve @everyone kullanamaz.

## Ticket'lar nasıl çalışır

- `open-a-ticket` kanalındaki **Ticket aç** butonu bir form açar: konu (kurulum,
  bildirimler, hata, hesap, diğer), açıklama ve isteğe bağlı en fazla 3 ekran görüntüsü
  (8 MB'a kadar görseller; thread'e kopyalanır, veritabanında tutulmaz). Form ve tüm mesajlar kullanıcının
  Dealio diline, yoksa Discord diline göre TR/EN/DE/FR olur.
- Dealio kanalda `#0042 · Bug report · kullanıcı` adlı, davet edilemeyen özel bir thread
  açar, kullanıcıyı ekler, açıklamayı ve **Ticket'ı kapat** butonunu gönderir.
  `ticket-log` kanalına bir satır yazar ve `Support Team` rolünü etiketler.
- Admins, Moderators ve Support Team ticket kanalında *Thread'leri Yönet* yetkisine sahip
  olduğu için bütün özel thread'leri görür ve yazabilir.
- Kullanıcı başına aynı anda bir açık ticket ve 24 saatte üç ticket hakkı vardır.
  Bir hafta sessiz kalan thread'i Discord arşivler; kullanıcı oraya yazınca yeniden açılır.
- Ticket'ı açan kişi ya da ekip kapatabilir. Dealio bir kapanış mesajı yazar, thread'i
  arşivleyip kilitler ve `ticket-log`'a kaydeder. Kilitli bir ticket'ı yalnızca ekip açabilir.
- Veritabanında yalnızca ticket'ın künyesi tutulur (numara, kullanıcı, konu, thread,
  durum, zamanlar). Konuşma Discord'da kalır. Kayıtlar kapanıştan 90 gün sonra silinir;
  `/delete-data` bunları da siler. Bu durum gizlilik politikasında yazılıdır.
