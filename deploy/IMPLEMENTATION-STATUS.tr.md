
# Kişisel Steam asistanı: uygulama ve yayın durumu

12 Eylül 2026. Bu dosya yayın kanıtı değildir.

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
- 646 otomatik test (49 dosya): eski testler ve yeni hedef, zamanlama, fiyat önbelleği, yedek, gizlilik senaryoları.
- Azure Bicep şablonu resmi derleyiciyle hatasız derlendi; kaynak kurulmadı.
- 20 Türkçe/İngilizce panel önizlemesi ve 16 sayfa/ekran kontrolünde taşma veya sayfa hatası yok.
- Açık SQLite yedeği, izole geri okuma, bütünlük kontrolü ve bozuk dosya reddi.
- Üretim bağımlılık taramasında bilinen açık bulunmadı.

## Henüz doğrulanmayan/yayımlanmayan
- Ayrı test botu bağlandı ve sekiz komut kaydedildi. Gerçek /setup denemesinde hata panelinin geçersiz simgesi bulundu ve düzeltildi. Kullanıcı test uygulamasını sildi ve mevcut ana bota kontrollü geçiş istedi; kapsamlı masaüstü/mobil kabul testi tamamlanmadı.
- Azure kredi türü/kalan tutarı ve yönetim yetkisi doğrulanamadı. Yeni kaynak oluşturulmadı.
- Azure'da gerçek kira yarışı, dış alarm teslimi, uzak yedek ve aylık geri yükleme çalıştırılmadı.
- SWA sayfaları yayımlanmadı; Discord uygulamasındaki eski yasal URL'ler değiştirilmedi.
- SteamWatch ile aynı oyun/bölge üzerinde canlı adım ve okunabilirlik karşılaştırması yapılmadı.
- Kullanıcı isteğiyle mevcut Azure VM üzerinde kontrollü geçiş hazırlanıyor. Önizleme gerçek Discord kabul testinin yerine geçmez.

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
