# Discord Botu İlk Sürüm Planı

## 1. Kapsam ve Kararlar

İlk sürümün amacı, bir Discord kullanıcısının public Steam profilindeki wishlist'i
tanımlamasını ve bu wishlist için manuel veya zamanlanmış kontrol başlatılmasını
sağlamaktır.

Kesinleşen kararlar:

- Steam hesabı için yalnızca SteamID64 kullanılacak.
- Steam profili public olacak; parola, cookie veya Steam oturum bilgisi
  istenmeyecek ve saklanmayacak.
- Slash komutları guild içinde kullanılacak.
- `/check` yalnızca komutu çalıştıran kullanıcının wishlist'ini kontrol edecek.
- İndirim bulunduğunda kullanıcıya DM gönderilecek.
- Her indirimli oyun için mümkünse ayrı bir DM mesajı gönderilecek.
- Kullanıcı bildirim dilini Türkçe veya İngilizce olarak seçebilecek.
- Yapılandırmayı devre dışı bırakma veya silme bu sürümde olmayacak.
- Steam wishlist verisini çekme entegrasyonu bu planın uygulama aşamasında ayrıca
  ele alınacak; bu belge komut ve Discord sınırlarını tanımlar.

İlk sürüm kapsamı dışı:

- Steam parolası, cookie veya özel wishlist desteği
- Vanity URL veya profil URL'sinden SteamID64 çözümleme
- `/disable`, `/remove` veya benzeri silme komutu
- Guild yöneticisi ayarları
- Kullanıcılar arasında ortak wishlist

## 2. Slash Komutları

### `/setup`

Önerilen seçenekler:

- `steamid64`: Zorunlu metin değeri. 17 haneli SteamID64 formatı doğrulanır.
- `language`: Seçim değeri: `Türkçe` veya `English`.

İş akışı:

1. Komutu kullanan Discord kullanıcısının ID'si alınır.
2. SteamID64 biçimsel olarak doğrulanır; Steam'e henüz ağ isteği yapılmaz.
3. Kullanıcı yapılandırması yoksa oluşturulur.
4. Mevcut yapılandırma varsa SteamID64 ve dil tercihi güncellenir.
5. Kullanıcıya ephemeral onay mesajı gönderilir.

İlk sürümde yapılandırmayı kapatma komutu olmayacağı için yapılandırma aktif
olarak kaydedilir. Kullanıcı dilini değiştirmek için aynı SteamID64 ile
`/setup` komutunu tekrar çalıştırabilir.

Örnek yanıtlar:

- Türkçe: `Steam wishlist'in ayarlandı. İndirim kontrolleri başlatılacak.`
- English: `Your Steam wishlist is configured. Sale checks are enabled.`

### `/status`

Yanıt ephemeral olmalıdır ve yalnızca komutu çalıştıran kullanıcıya gösterilir.
Şu bilgiler gösterilir:

- Yapılandırma durumu
- SteamID64
- Bildirim dili
- Son kontrolün zamanı
- Son kontrol durumu: `bekliyor`, `başarılı`, `kullanılamıyor` veya `hatalı`
- Bir sonraki zamanlanmış kontrol zamanı

Steam entegrasyonu henüz kullanılabilir değilse bu durum açıkça belirtilir;
başarılı kontrol yapılmış gibi gösterilmez. Yapılandırma yoksa `/setup` komutu
önerilir.

### `/check`

İş akışı:

1. Kullanıcının yapılandırması aranır.
2. Yapılandırma yoksa işlem başlatılmadan `/setup` önerilir.
3. Aynı kullanıcı için devam eden bir kontrol varsa ikinci işlem reddedilir.
4. Kontrol işlemi başlatılır ve Discord interaction için `deferReply` kullanılır.
5. Kontrol sonucu tamamlandığında kullanıcıya ephemeral özet gönderilir.

Manuel kontrol yalnızca ilgili kullanıcının wishlist'i üzerinde çalışır. Steam
yanıt vermiyorsa veya veri doğrulanamıyorsa işlem `başarısız` olarak kaydedilir;
bu durum indirim veya başarılı kontrol olarak yorumlanmaz.

## 3. İndirim DM Bildirimleri

Bir oyun `on-sale: false` durumundan `on-sale: true` durumuna geçtiğinde bildirim
oluşturulur. Aynı indirim için daha önce başarıyla gönderilmiş bir bildirim
tekrar gönderilmez.

Tercih edilen format, her oyun için ayrı bir DM'dir:

```text
🎮 Hades indirimde!

Önceki fiyat: 24,99 €
Güncel fiyat: 9,99 €
İndirim: %60
```

Mesajda ayrıca:

- Steam mağaza bağlantısı
- Steam'den alınabiliyorsa oyun banner/header görseli
- Kullanıcının seçtiği dilde başlık ve açıklama

bulunur. Görsel alınamazsa bildirim görselsiz gönderilmeye devam eder.

Bir wishlist'te aynı anda çok sayıda oyun indirime girdiyse mesajlar Discord
rate limitlerine uyularak sırayla gönderilir. DM kapalıysa veya gönderim
başarısızsa bildirim `gönderilmedi` olarak kalır; gönderildi kaydı yalnızca
Discord gönderimi başarıyla tamamlandıktan sonra yazılır.

Fiyat karşılaştırması için en az şu bilgiler saklanmalıdır:

- Oyun/app ID'si
- Oyun adı
- Önceki bilinen normal fiyat
- Önceki indirim durumu
- Güncel fiyat ve indirim yüzdesi
- Para birimi
- Son başarılı Steam kontrol zamanı
- Bildirim gönderim durumu

Steam veya mağaza verisi kullanılamıyorsa mevcut fiyat durumu değiştirilmez.

## 4. Kullanıcı Yapılandırması ve Persistence

Discord ve Steam kodu ayrı modüllerde kalmalıdır. Discord komutları yalnızca
uygulama servislerini çağırmalı; SQLite sorguları komut handler'larına
yazılmamalıdır.

Önerilen minimum kayıtlar:

### `user_config`

- `discord_user_id` - primary key
- `steam_id64` - unique olmayan SteamID64 metni
- `language` - `tr` veya `en`
- `enabled` - ilk sürümde her yeni yapılandırma için `1`
- `created_at`
- `updated_at`

### `check_state`

- `discord_user_id` - `user_config` ile ilişki
- `last_started_at`
- `last_completed_at`
- `last_status`
- `last_error_code`, varsa
- `next_scheduled_at`, scheduler tarafından hesaplanacak veya yazılacak

Bildirim ve fiyat geçmişi tabloları Steam entegrasyonunun uygulandığı aşamada
eklenmelidir. Duplicate bildirim kontrolü için oyun ID'si, satış durumu/fiyat
geçişi ve kullanıcı birlikte değerlendirilmelidir.

Node'un built-in `node:sqlite` modülü kullanılmalı, native SQLite bağımlılığı
eklenmemelidir. Veritabanı dosyasının bulunduğu dizin uygulama başlangıcında
hazır olmalı ve `.env` veya veritabanı dosyası repoya alınmamalıdır.

## 5. Önerilen Modül Yapısı

```text
src/discord/
  client.ts
  commands/setup.ts
  commands/status.ts
  commands/check.ts
  register-commands.ts

src/application/
  configure-user.ts
  get-user-status.ts
  check-user-wishlist.ts

src/persistence/
  database.ts
  user-config-repository.ts
  check-state-repository.ts

src/steam/
  wishlist-client.ts       # sonraki aşama

src/scheduler/
  poller.ts                # sonraki aşama
```

Komutların dil metinleri Discord handler'larına dağılmamalı; küçük bir
çeviri/catalog katmanından alınmalıdır. Desteklenen diller için sabit bir
union tipi kullanılmalıdır: `tr | en`.

## 6. Discord Bot Kurulumu

### Developer Portal

1. Discord Developer Portal'da yeni bir Application oluşturulur.
2. Application ID, projedeki `DISCORD_CLIENT_ID` değeridir.
3. **Bot** bölümünden bot user oluşturulur.
4. Bot token alınır ve yalnızca `.env` içinde tutulur.
5. Token loglara yazılmaz ve repoya commit edilmez.

### OAuth2 kurulum bağlantısı

Botu test guild'ine eklemek için OAuth2 URL Generator'da şu scope'lar seçilir:

- `bot`
- `applications.commands`

Guild içinde ephemeral yanıt gönderebilmek ve komutları kullanabilmek için
başlangıçta `View Channel` ve `Send Messages` izinleri verilmesi yeterlidir.
Bildirimler DM ile gönderileceğinden DM için ayrıca guild permission gerekmez;
ancak kullanıcı botun DM göndermesine izin vermeli ve botu engellememiş olmalıdır.

İlk sürümde yalnızca `Guilds` gateway intent'i yeterlidir. `Message Content`,
`Guild Members` veya `Presence` gibi privileged intent'ler açılmamalıdır.

### Guild ID nedir?

Guild ID, Discord sunucusunun benzersiz sayısal ID'sidir. Komutları geliştirme
sırasında yalnızca bir sunucuda hızlıca görünür yapmak için kullanılır.

Bulma adımları:

1. Discord **User Settings > Advanced > Developer Mode** seçeneğini aç.
2. Test sunucusunun adına veya ikonuna sağ tıkla.
3. **Copy Server ID** seçeneğini kullan.

Bu değer `.env` içinde örneğin `DISCORD_GUILD_ID` olarak tutulmalıdır. Guild
command registration geliştirme sırasında anında görünür; global komutların
Discord tarafından yayılması daha uzun sürebilir.

### Environment değişkenleri

Zorunlu:

```env
DISCORD_TOKEN=
DISCORD_CLIENT_ID=
DISCORD_GUILD_ID=
```

Mevcut proje değişkenleri:

```env
DATABASE_PATH=./data/wishlist.db
POLL_INTERVAL_HOURS=6
```

Uygulama, zorunlu değerler eksikse yalnızca uyarı verip çalışmaya devam
etmemeli; açık bir yapılandırma hatasıyla başlamayı durdurmalıdır.

## 7. Komut Kayıt ve Çalışma Akışı

Komut tanımları ile Discord API'ye komut kaydı ayrı tutulmalıdır.

- Geliştirme: `Routes.applicationGuildCommands(clientId, guildId, commands)`
- Production: ihtiyaç kesinleştiğinde global application commands
- Client login sonrasında komutların tekrar tekrar gereksiz kayıt edilmesi
  engellenmeli veya ayrı bir deployment adımı kullanılmalı.

Uygulama başlangıcı:

1. Environment doğrulaması
2. SQLite bağlantısı ve şema hazırlığı
3. Discord client oluşturulması
4. Sadece `Guilds` intent'iyle login
5. Slash command registration
6. Bot hazır durumunun loglanması

Scheduler, Discord client'tan ve Steam istemcisinden ayrı olmalıdır. Varsayılan
polling aralığı altı saattir. Manuel `/check` ve scheduler aynı uygulama servisini
kullanmalı, farklı kontrol mantıkları oluşturmamalıdır.

## 8. Hata, Güvenlik ve Test Gereksinimleri

- Kullanıcıya gösterilen hata mesajları Türkçe/İngilizce tercihe göre seçilir.
- Teknik hata ayrıntıları kullanıcıya veya DM'e sızdırılmaz.
- Dış istekler timeout ile yapılır.
- Steam yanıtı yoksa fiyat ve satış durumu güncellenmez.
- Aynı kullanıcı için eşzamanlı kontroller kilitlenir.
- DM gönderim başarısızlığı başarılı bildirim olarak işaretlenmez.
- Kullanıcı yalnızca kendi `discord_user_id` kaydını okuyabilir.
- SteamID64 doğrulaması komut katmanında başlatılır ve uygulama katmanında da
  güvenilir veri olarak varsayılmaz.

Test planı:

- `/setup` yeni kullanıcı oluşturur.
- `/setup` mevcut kullanıcıyı günceller.
- Türkçe ve İngilizce metin seçimi doğru çalışır.
- Yapılandırmasız `/status` ve `/check` kontrollü yanıt verir.
- `/check` yalnızca çağıran kullanıcının yapılandırmasını kullanır.
- Eşzamanlı ikinci `/check` reddedilir.
- Steam erişilemezliği başarılı kontrol veya indirim olarak kaydedilmez.
- Not-on-sale'dan on-sale'a geçiş bildirim üretir.
- Aynı satış için duplicate bildirim gönderilmez.
- Banner olmadan bildirim gönderilebilir.

## 9. Uygulamaya Başlamadan Önce Netleştirilecekler

Kullanıcıdan gereken bilgiler:

1. Geliştirme için kullanılacak Discord test guild'inin ID'si.
2. Steam mağaza fiyatlarının hangi ülke/para birimine göre okunacağı. Önerim,
   kullanıcının mağaza bölgesini veya ilk sürümde sabit `TR` bölgesini kullanmak;
   bunun teknik kararı Steam entegrasyonu başlamadan verilmelidir.
3. Discord mesajlarının varsayılan dili. Önerim: `/setup` dil seçilmezse Türkçe.
4. Birden fazla indirimin DM rate limitleri nedeniyle gecikmeli gönderilmesi
   kabul ediliyor mu? Önerim: evet; oyunlar tek tek, güvenli hızda gönderilsin.
5. Steam'deki fiyat geçmişi bulunamazsa “önceki fiyat” olarak botun ilk başarılı
   gözlemini kullanmak kabul ediliyor mu? Önerim: evet, ilk gözlem baseline olsun;
   ilk gözlemde bildirim gönderilmesin.

Bu kararlar verildikten sonra komutların implementasyonu ve ardından public
Steam wishlist istemcisi ayrı bir aşama olarak yapılmalıdır.
