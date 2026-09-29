
# Kişisel Steam asistanı: uygulama ve yayın durumu

12 Eylül 2026. Bu dosya kontrollü geçiş kanıtını ve kalan yayın işlerini ayırır; genel açık beta kapılarının geçtiği anlamına gelmez.

## Uygulanan geliştirme
- Şema 10: hedef fiyat, para birimi, susturma, kural sürümü, kalıcı hedef geçişi.
- Beş dakikalık ülke/dil/oyun önbelleği, sorgu birleştirme, gerçek gözlem zamanı.
- Kayıtlı wishlist ilk açılışı, arama, uygun fırsat filtresi, oyun detayları ve fiyat gözlemleri.
- Tespit edilince, sessiz saatler, günlük özet; IANA saat dilimi doğrulaması.
- Bekleyen tekliflerin gönderim öncesi yeniden doğrulanması ve Discord teslimat kimliği.
- Bildirim geçmişi ve DM erişimini deneme.
- Azure kira istemcisi, tutarlı yedek/izole geri yükleme, bağımsız sağlık göndericisi ve alarm şablonu.
- Türkçe/İngilizce tanıtım, yardım ve yasal sayfalar; SWA Free yayın işi.
- Günlük sır ayıklama; 30/90 günlük veri temizliği ve Dealio'ya özel yedi günlük journald ayarı.

## Yerelde doğrulananlar
- Temiz bağımlılık kurulumu; uygulama ve handoff tür kontrolleri; üretim derlemesi.
- 648 otomatik test (50 dosya): eski testler ve yeni hedef, zamanlama, fiyat önbelleği, yedek, gizlilik senaryoları.
- Azure Bicep şablonu resmi derleyiciyle hatasız derlendi; kaynak kurulmadı.
- 20 Türkçe/İngilizce panel önizlemesi ve 16 sayfa/ekran kontrolünde taşma veya sayfa hatası yok.
- Açık SQLite yedeği, izole geri okuma, bütünlük kontrolü ve bozuk dosya reddi.
- Üretim bağımlılık taramasında bilinen açık bulunmadı.

## Henüz doğrulanmayan/yayımlanmayan
- Ayrı test botu bağlandı ve sekiz komut kaydedildi. Gerçek /setup denemesinde hata panelinin geçersiz simgesi bulundu ve düzeltildi. Kullanıcı test uygulamasını sildi ve mevcut ana bota kontrollü geçiş istedi; proje sahibi daha sonra ana bot için manuel kontrol listesinin çalışıyor göründüğünü bildirdi. Cihaz ve senaryo bazında ölçümlü kabul kaydı bulunmuyor.
- Azure kredi türü/kalan tutarı ve yönetim yetkisi doğrulanamadı. Yeni kaynak oluşturulmadı.
- Azure'da gerçek kira yarışı, dış alarm teslimi, uzak yedek ve aylık geri yükleme çalıştırılmadı.
- SWA sayfaları yayımlanmadı; Discord uygulamasındaki eski yasal URL'ler değiştirilmedi.
- SteamWatch ile aynı oyun/bölge üzerinde canlı adım ve okunabilirlik karşılaştırması yapılmadı.
- Kullanıcı isteğiyle mevcut Azure VM üzerinde kontrollü geçiş 12 Eylül 2026 16:25 UTC tarihinde tamamlandı. Sürüm b78bc7d; şema 10; Discord bağlantısı hazır. Önizleme gerçek Discord kabul testinin yerine geçmez.

SteamWatch'ın haber/Workshop/mağaza komutları bu sürümün kapsamına alınmadı. Dealio'nun seçilen farkı kişisel fiyat kuralları, saat dilimine göre bildirim kontrolü ve açıklanabilir teslimat geçmişidir. Ölçülmemiş hız veya “rakipsiz” iddiası yoktur.

Kaynaklar:
- https://steam.watch/
- https://github.com/dukeofsussex/SteamWatch
- https://learn.microsoft.com/en-us/azure/storage/blobs/security-recommendations
- https://learn.microsoft.com/en-us/javascript/api/@azure/storage-blob/blobleaseclient
- https://learn.microsoft.com/en-us/azure/static-web-apps/plans


## Mevcut VM üzerinde kontrollü geçiş
- Kullanıcının 12 Eylül 2026 isteği: ayrı test botunu bırakıp ana bota geçiş.
- Azure kaynakları/kredi doğrulanana kadar isteğe bağlı tek sunucu modu: DEALIO_PRODUCTION=true ve DEALIO_SINGLE_HOST_MACHINE_ID.
- /etc/machine-id eşleşmesi zorunlu; yapılandırma başka makineye taşınırsa başlangıç reddedilir. Aynı işletim sistemi kullanıcısında uygulama kimliği kilidi farklı veritabanıyla ikinci başlangıcı da reddeder.
- Bu mod dağıtık Azure Blob kiralamasının yerini tutmaz; makine klonlama ve farklı işletim sistemi kullanıcıları için dağıtık kilit güvencesi vermez. Azure kira yolu ve genel yayın kapıları korunur.
- Kontrollü geçişte tutarlı yerel VM yedeği, izole göç/geri okuma ve otomatik testler uygulanır. Uzak yedek, bağımsız alarm, yasal sayfa yayını ve kredi doğrulaması tamamlanmış sayılmaz.


## Kontrollü geçiş kanıtı — 12 Eylül 2026
- GitHub PR #1 ana dala birleştirildi; yayımlanan kod b78bc7d617a82790d0ba85196180ace201578a15.
- Azure üzerinde temiz bağımlılık kurulumu, uygulama/handoff tür kontrolleri, derleme ve 646 test geçti.
- Eski şema 9 veritabanının izole kopyası şema 10'a geçirildi; bütünlük ve yabancı anahtar denetimleri geçti.
- Canlı hizmet durdurulduktan sonra tutarlı geri dönüş veritabanı alındı; eski derleme ve bağımlılıklar VM'de saklandı. Yedeğe .env dahil edilmedi.
- Yeni hizmet phase=ready, discordReady=true; sekiz komut doğrulandı. Bir kayıtlı kullanıcı korundu.
- Farklı veritabanı yolu kullanılarak ikinci üretim başlangıcı denendi; uygulama kilidi Discord'a bağlanmadan reddetti, ikinci veritabanı oluşmadı.
- Yereldeki ana proje main ile güncellendi ve derlendi; yerel üretim ve silinen test botunun hizmetleri kapalı.
- Geri dönüş dosyaları: /home/dealiobot/dealio-backups/20260912-personal-assistant/. Bunlar aynı VM'dedir; uzak felaket kurtarma yedeği sayılmaz.

### Bu geçişten geri dönüş
1. dealio hizmetini durdur; mevcut veritabanı ve varsa WAL/SHM dosyalarını ayrı bir konuma koru. Başarılı açılıştan sonra yeni kullanıcı işlemleri oluşmuş olabileceği için bu işlemlerin kaybını değerlendir.
2. Eski kod revizyonu 8025eeda9e7c1fe3d60acefeff0fa08521cabc6e, old-dist ve old-node_modules ile eşleşen wishlist-pre-deploy.db yedeğini birlikte geri getir. Yalnız eski kodu çalıştırma.
3. Bu geçişin eklediği /etc/systemd/system/dealio.service.d/single-host.conf dosyasını kaldır; daemon-reload yap ve hizmeti başlat.
4. Discord bağlantısını ve veritabanı bütünlüğünü tekrar doğrula. Eski sürümde dağıtık/uygulama kimliği kilidi bulunmadığından yerel botu çalıştırma.


## Ana ekran yenilemesi ve beta tanımı
- 12 Eylül 2026 16:33 UTC: 7f4e5868bc33f1abf1089e1512cd703e3451939d ana botta açıldı. Büyük oyun görseli/fiyat alanı ve üç kişisel kontrol bölümü eklendi.
- Yerelde ve Azure'da 648 test geçti; bu revizyonun Node.js 22/24 GitHub kontrolleri başarılı.
- Gerçek kayıtlı wishlist verileriyle panel üretimi: 30 oyun, 3 uygun oyun, 26 bileşen, 762 metin karakteri. Bunlar o doğrulama anının ölçümleridir.
- Açılış sonrası phase=ready ve discordReady=true; kontrol edilen son günlüklerde hata yok.
- Proje sahibi kontrol listesi sonrası “sanırım hepsi çalışıyor” geri bildirimini verdi. Bu, sınırlı beta için kullanıcı geri bildirimidir; bütün cihaz/zamanlı teslim senaryolarını geçti diye işaretlemez.
- README'ler mevcut ürünü sınırlı beta olarak tanıtır. Herkese açık beta için yasal bağlantılar, uzak yedek, dış alarm, kredi ve dağıtık kilit doğrulaması açık kalır.


## 29 Eylül 2026 — ücretsiz sınırlı beta işletimi

Önceki Azure ücretli kaynak yaklaşımının yerine kullanıcı ek ücret istemediği
 için GitHub şifreli yedek/restore, Healthchecks e-posta ve ayrı GitHub Pages
sitesi kullanıldı. Gerçek uzak yedek ve restore işleri geçti, sinyal kaybı ve
 iyileşme kaydedildi. Ayrıntılı kabul ve bekleyen kullanıcı gözlemi:
`docs/phase3-acceptance.tr.md`; işletim: `deploy/FREE-OPERATIONS.tr.md`.
Azure dağıtık lease kurulmadı: tek VM süreç kilidi sürer; ikinci aktif bot
örneği açılmaz. Genel yayın kapısı dördüncü aşama kanıtları tamamlanana kadar
kapalıdır. Bu kayıt eski Azure maddelerini tamamlandı saymaz.
