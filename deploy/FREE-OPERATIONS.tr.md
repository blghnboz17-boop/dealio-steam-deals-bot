# Ücretsiz işletim

Bu dosya kurulum ve kurtarma talimatıdır.

## Sınırlar ve maliyet

Mevcut VM dışında ücretli kaynak açılmaz. Azure birleşik Bicep şablonu bu
kurulumda kullanılmaz.

### Azure aboneliği (7 Ekim 2026'da portaldan okundu)

- Abonelik: Azure for Students. 100 USD kredi, 83 USD kaldı, bitiş 7 Eylül 2027.
  12 aylık ücretsiz servisler de bu tarihe kadar geçerlidir; yenileme öğrenci
  hesabına bağlıdır.
- VM `Standard_B2ats_v2` (AMD, 2 vCPU, 1 GiB): ücretsiz kotada (ayda 750 saat).
  Önceki `Standard_B2ts_v2` kotada değildi ve ayda yaklaşık 7,4 USD tutuyordu.
- İşletim sistemi diski 64 GiB Premium SSD (P6): ücretsiz kotada. Önceki 30 GiB
  (P4) kotaya girmiyordu, ayda yaklaşık 5,4 USD. Disk küçültülemez.
- Standard sabit genel IP kotada yoktur, ayda yaklaşık 3,5 USD.
  VM durdurulup başlatıldığında değişmez.
- Beklenen aylık maliyet yaklaşık 3,5 USD (önce yaklaşık 17,4 USD); bu hızla
  kredi bitiş tarihine kadar yeter. Cost Management'ta free services kullanımı
  sıfırdan büyük görünmelidir.
- Bütçe `dealio-aylik`: gerçek maliyet ayda 8 USD'yi geçerse okul adresine e-posta.
- Service Health kuralı `dealio-azure-saglik` (eylem grubu `dealio-email-global`):
  arıza, planlı bakım ve güvenlik duyurusunda e-posta. Eylem grubunun e-postası
  doğrulanmadan bildirim gönderilmez.
- Öğrenci politikası kaynak bölgelerini sınırlar (aşağıya bakın). Service Health
  eylem grupları yalnız `Global` bölgesinde çalışır ve bu bölgeye izin vardır.
- VM boyutu çalışırken B2ats v2'ye çevrilemez ("Unsupported hardware"); önce
  durdurulup serbest bırakılır (deallocate), sonra boyut ve disk değiştirilir. GitHub Actions hesabındaki 0 USD bütçe ve Stop usage
koruması korunur. Kota dolması yedek işini durdurabilir; Healthchecks sinyal
kesilmesini dışarıdan izler. Günlük şifreli yedek özel `dealio-backups` deposunda haftanın gününe göre bir dalda tutulur; her kopya yedi gün sonra yenisiyle değiştirilir;
veritabanı üst sınırı 16 MiB, şifreli çıktı üst sınırı 23 MiB'dir. Bu sınırlar
GitHub hesabının diğer projelerle paylaşılan ücretsiz kotasını garanti etmez.

## Canlı hedef

Bu kurulumun gerçek hedefi `dealiobot` kullanıcısı,
`/home/dealiobot/steam-wishlist-discord-bot`, `/usr/bin/node` (Node 22).
Eski `deploy/dealio.service` örneğindeki bilgehan yolları bu VM'yi tarif etmez.
Derleme/test VM dışında yapılır; test edilen commit ve dist birlikte aktarılır.

## Anahtarlar ve izinler

- RSA şifreleme anahtar çifti üretim dışında oluşturulur. Genel anahtar VM'de
  `/home/dealiobot/.config/dealio/backup-public.pem` olarak tutulur.
- Özel anahtar yalnız erişimi kısıtlı operatör kurtarma kopyasında ve GitHub deposunun `DEALIO_BACKUP_PRIVATE_KEY` sırrında bulunur.
  Anahtar kaybedilirse yedek açılamaz. Anahtar döndürülürken eski yedeklerin
  anahtarı saklama süresi bitene kadar korunur.
- Ayrı SSH anahtarı yalnız yedek dışa aktarmaya izin verir. `authorized_keys`
  girdisi `restrict,command="/usr/local/bin/dealio-export-backup"` ile başlar.
  Sarmalayıcı root sahibi, 0755 izinli olmalı; repo dizinine geçip yalnız
  `/usr/bin/node scripts/export-backup.mjs` çalıştırmalıdır.
- SSH anahtarı komut kabuğu, port/agent/X11 yönlendirmesi veya PTY açamaz.
  Kurulum kabulünde `ssh ... id` isteğinin sadece şifreli yedek döndürdüğü ve
  yönlendirme isteğinin reddedildiği doğrulanır. Normal yönetici anahtarı korunur.
- Sunucu anahtarı önceden doğrulanmış known_hosts kaydından sabitlenir;
  yalnız `ssh-keyscan` çıktısına güvenilmez. StrictHostKeyChecking kapatılmaz.
- GitHub deposunun Actions sırlarında `BACKUP_SSH_KEY`, `BACKUP_KNOWN_HOSTS`,
  `BACKUP_SSH_TARGET`, `DEALIO_BACKUP_PRIVATE_KEY`, `HEALTHCHECKS_BACKUP_PING_URL`
  ve `HEALTHCHECKS_RESTORE_PING_URL` gerekir. Bot deposu public olduğu için
  şifreli yedek workflow artifact'i olarak yüklenmez: `BACKUP_REPO_SSH_KEY` yalnız
  özel `dealio-backups` deposuna write yetkili deploy key, `BACKUP_REPO_KNOWN_HOSTS`
  GitHub'ın `/meta` SSH anahtarlarıdır. VM adresi de bu yüzden değişken değil sırdır.
- VM .env: `DEALIO_BACKUP_PUBLIC_KEY_FILE`, `HEALTHCHECKS_BOT_PING_URL`.
  Ping URL'leri sırlıdır; ekran görüntüsü, günlük veya Git'e yazılmaz.

## Bağımsız alarm

Ücretsiz Healthchecks hesabında e-posta alıcısı doğrulanır ve üç ayrı kontrol
oluşturulur: bot için 1 dakika periyot/3 dakika tolerans; yedek için 24 saat
periyot/2 saat tolerans; aylık restore için 35 gün periyot/1 gün tolerans.
`dealio-health.timer` her dakika bot sürecinden bağımsız çalışır. Sağlık
kategorileri dışında kullanıcı kimliği, fiyat listesi veya veritabanı göndermez.
VM tamamen kapanırsa dış servis eksik sinyali algılar.

Önce gerçek servis kullanıcısıyla `node scripts/health-ping.mjs --preview`
çalıştırılır. Ardından health service/timer yüklenir ve etkinleştirilir.
Alarm provasında botu durdurmak gerekmez: yalnız health timer durdurulur,
kaçırılan sinyal e-postasının kullanıcıya ulaştığı kaydedilir, timer yeniden
başlatılır ve iyileşme doğrulanır. Prova başarısız olsa da timer geri açılır.

## Yedek ve geri yükleme kabulü

1. GitHub `Encrypted offsite backup` işi elle tetiklenir; işin başarılı olması
   ve `dealio-backups` deposunda o günün dalının güncellendiği doğrulanır.
2. `Offsite restore rehearsal` işi en yeni dalın şifreli yedeğini alır, ayrı geçici
   kopyada şifre çözer, SQLite integrity/foreign-key kontrolü yapar ve mevcut
   şema geçişlerini uygular. Üretim DB'sine ve Discord'a bağlanmaz.
3. İş kimlikleri, kaynak commit, saat ve kişisel veri içermeyen restore raporu
   kabul kaydına eklenir. Restore kanıtı 35 gün tutulur.
4. İş başarısızlığı veya hiç çalışmaması ayrı yedek/restore alarmıyla denenir.

Gerçek felaket kurtarmasında önce bot durdurulur; mevcut DB/WAL/SHM ayrıca
korunur. Uzak yedek ayrı dizinde çözülüp doğrulanır; yalnız doğrulanan DB doğru
sahiplik ve 0600 izinle yerleştirilir, eski WAL/SHM yeni DB'ye taşınmaz.
Yedekten sonra yapılmış veri silme talepleri yeniden uygulanır. Bot başlatılır,
sağlık ve gerçek DM doğrulanır; belirsiz teslimat kayıtları otomatik tekrar
bildirim üretmek için temizlenmez. Başarısızlıkta korunan eski DB'ye dönülür.
Kurtarma provası bu üretim değiştirme işlemini otomatik yapmaz.

## Yayın

Sadece izin verilen on statik dosya yayımlanır; repo, .env, kanıtlar ve DB
siteye dahil edilmez. Ana sayfanın düğmesi Discord'un varsayılan kurulum
bağlantısını açar. Gizlilik/koşullar/yardım HTTPS bağlantıları ve Discord
uygulama bağlantıları ayrıca doğrulanır; yayın kapısında kanıtlar gerçek
denemeler yapılmadan geçti işaretlenmez.

### Site sağlayıcısı

Azure öğrenci politikası yalnız Switzerland North, Germany West Central,
Sweden Central, Italy North ve Austria East bölgelerine izin verdiği için
Static Web Apps kurulumu reddedildi; desteklenen beş SWA bölgesiyle kesişim yok.
Ücretli kaynak açılmadı. Site GitHub Free ile ayrı `dealio-public-pages`
public deposundan yayımlanır. Yayın işi yalnız
onaylı statik çıktıyı kopyalar. `PUBLIC_PAGES_SSH_KEY` sadece site deposuna
write yetkili deploy key, `PUBLIC_PAGES_KNOWN_HOSTS` GitHub'ın TLS ile alınan
resmî `/meta` SSH anahtarlarıdır. Kullanıcı yedeği bu public depoya gitmez.

Bot günlükleri `LogNamespace=dealio` ve `journald@dealio.conf` ile yedi günlük
ayrı alana yazılır. Ücretli Azure lease zorunluluğu getiren production örnek
konfigürasyonu kurulmaz; tek VM süreç kilidi korunur. Önceki sistem günlükleri
sistem politikasına tabidir; diğer servislerin kayıtları silinmez.
