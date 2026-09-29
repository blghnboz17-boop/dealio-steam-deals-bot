# 3. aşama: açık beta işletimi

Başlangıç: 29 Eylül 2026, `c65e9f0a11dce26a5f3423b72bd92c7cd7aae103`.
Durum: devam ediyor; genel yayın onayı verilmedi.

## İş sırası ve kabul

1. Azure kredisi, bitiş tarihi, harcama sınırı ve mevcut kaynakları doğrula;
   ek hizmetlerin maliyetini belirle. Bunlar netleşmeden ücretli kaynak açma.
2. Özel uzak yedek, günlük görev ve izole geri yükleme provası kur.
3. VM sustuğunda da algılayan bağımsız alarmı kur; kullanıcı tarafından
   belirlenen alıcıya test alarmı ve düzelme teslimini doğrula.
4. Türkçe/İngilizce koşullar, gizlilik ve yardım sayfalarını mevcut site
   akışıyla yayımla. Kaynak repo özel kalır; yalnız izin listesindeki dosyalar
   yayımlanır. Discord uygulamasındaki bağlantıları doğrula.
5. Yayın kapısını gerçek kayıtlarla çalıştır; sonraki aşamadaki masaüstü/mobil
   ve uzun süreli beta kabulünü bu aşamada geçmiş gibi işaretleme.

## İlk inceleme

- VM botu aktif; yedek/geri yükleme/izleme systemd zamanlayıcıları listede yok.
- Azure Portal: Azure for Students aktif, kullanıcı Owner, görünen güncel
  maliyet 12,63 USD. Bu tutar kalan kredi değildir. Kalan kredi, bitiş tarihi
  ve harcama sınırı henüz doğrulanmadı.
- GitHub `public-site` ortamı sır listesi 404 döndürüyor; yayın kimlik bilgisi
  hazır kabul edilmiyor.
- Uzak yedek, Azure Monitor, özel konteyner ve SWA Free şablonları mevcut.
  Şablonun varlığı canlı kurulum kanıtı sayılmıyor.
- Yayın kapısı kanıt dosyalarını ve alt dosyalarını zaten kontrol ediyor;
  yardım bağlantısının HTTPS/erişilebilirlik kontrolü eklenecek.

## Kararlar

- Kullanıcı ek ücreti reddetti. Ücretli Azure Monitor/Blob kurulumu yapılmaz.
  Healthchecks.io Hobbyist ($0, 20 kontrol) ve mevcut GitHub Free kotası
  değerlendirilir. Alarm alıcısı kullanıcı tarafından blghnboz17@gmail.com
  olarak seçildi. Healthchecks hesap açılışı kullanıcıda bekliyor.
- Azure kredisi yaklaşık 87,37 USD, son tarih 7 Eylül 2027, harcama sınırı On;
  portal ve salt okunur ARM sorgusu ile doğrulandı. Yeni kaynak kurulmadı.
- Ücretsiz yedek tasarımı: günlük GitHub Actions işi yalnız yedek dışa aktarma
  komutuna izinli SSH anahtarıyla tutarlı SQLite kopyasını alır. Kopya VM'den
  çıkmadan şifrelenir; yedi günlük özel artifact olarak saklanır. Şifre çözme
  anahtarı VM'ye konmaz. Kota veya iş başarısızlığında bağımsız yedek alarmı
  devreye girer. GitHub ücretli aşım koruması doğrulanmadan iş etkinleştirilmez.
- Sağlık tasarımı: bot dışındaki systemd işi yaşam sinyali, Discord bağlantısı,
  son başarılı tarama ve kuyruk yaşını denetler. Healthchecks'e yalnız sonuç
  gönderir; kullanıcı kimlikleri veya veritabanı göndermez. VM sustuğunda dış
  servis sinyal eksikliğini algılar. Yedek ve geri yükleme ayrı kontrollerdir.
- Sayfalar için SWA Free seçeneği korunur; ücretli plan seçilmez.

- Önceki aşamadaki 1 GiB VM bellek baskısı nedeniyle derleme ve tam testler
  üretim dışında yapılır; VM'ye doğrulanmış çıktı aktarılır.
- Mevcut Azure şablonu ancak maliyet ve kredi incelendikten sonra kullanılır.
  Alarm alıcısı ve yayımlanacak iletişim bilgisi doğrulanmadan varsayılmaz.
- Gerçek alarm, uzak geri yükleme ve erişilebilir sayfa kanıtları olmadan
  üçüncü aşama tamamlandı denmez.

## Yerel doğrulama — 29 Eylül 2026

- Şifreli SQLite dışa aktarma/ayrı kopyada açma, bütünlük ve şema denemesi geçti.
- `npm run typecheck`, `npm run typecheck:handoff`, derleme ve 60 dosyada
  745 test geçti (`npm test -- --maxWorkers=4`). Test işçisi sayısı dört ile
  sınırlandı; çok sayıda eşzamanlı Git işlemi Windows'ta 5 saniyelik test
  sınırını aşmıştı. Üretim botunun eşzamanlılığı değişmedi.
- Aralıklı handoff eksik-kayıt hatası gerçek dosya sisteminde yakalandı:
  atomik rename Windows EPERM, 1.000 denemede 3 hata. Windows'a özgü sınırlı
  yeniden deneme sonrası 1.000 denemede 0 hata. Yeni 5 regresyon testi geçti;
  kalıcı erişim hatası yine başarısız olur, mevcut kayıt silinmez.
- Onaylı on dosyalık site derlemesi geçti. Sayfalar sınırlı beta olarak hazır;
  henüz yayımlanmadı.
- Bağımsız kod incelemesinde doğrulanmış önemli kusur bulunmadı. Canlı SSH
  kısıtlaması, dış yedek, alarm e-postası ve site kabulü hâlâ bekliyor.
- GitHub Free bütçesinde Actions 0 USD / Stop usage Yes arayüzden doğrulandı;
  ücretli aşım açılmadı. Başlangıç artifact kullanımı 0 bayt.
- Kurulum ve kurtarma adımları: `deploy/FREE-OPERATIONS.tr.md`.

- GitHub Free özel depoda ortam sırları ücretli plan gerektirdiğinden işler
  repository secrets kullanır; çalıştırma main dalıyla sınırlıdır. Ücretli
  GitHub planı veya environment koruması varsayılmaz.

## Canlı işletim doğrulaması — 29 Eylül 2026

- Hazırlık PR #6 main'e `f25e212c2d703b930fef69863dabf59f4ce94666` ile
  birleştirildi; bu revizyonun GitHub CI Node 22/24 kontrolleri geçti
  (run 36622558576). Yerelde derlenen çıktı VM'ye hash doğrulanarak
  taşındı; VM'de derleme yapılmadı. Bot active/Discord ready, NRestarts=0.
- RSA kurtarma anahtarı VM dışında. Ayrı yedek SSH anahtarı forced-command
  ile yalnız şifreli dışa aktarıma bağlı. Tamamen ayrı SSH yapılandırmasıyla
  `id` isteği şifreli zarf döndürdü; uzak port yönlendirmesi reddedildi.
- GitHub uzak yedek run 36622820238 ikinci denemede geçti. İlk denemede
  otomasyon anahtarındaki parola ayarı nedeniyle giriş reddedildi; düzeltildi.
  Kullanıcı kimlikleri veya açık veritabanı Actions çıktısına yazılmadı.
- Gerçek uzak artifact'ten restore run 36622998327 geçti; checkedAt
  2026-09-29T19:58:49.304Z, şema 10, integrity/foreign-key/migration başarılı.
- Healthchecks ücretsiz hesapta üç kontrol kuruldu; e-posta üçüne de bağlı.
  Bot 1dk+3dk, yedek 1gün+2saat, restore 35gün+1gün. Bot sinyali 19:58:24Z'de
  durduruldu, 20:02'de up→down oluştu ve sağlayıcı e-postayı Delivered gösterdi.
  20:02:56Z'de timer/sinyal yeniden açıldı; down→up ve dakikalık sinyal görüldü.
  Bot bu provada açık kaldı. Kullanıcı bot health ve daily offsite e-postalarını
  aldığını, görüntülenen durumun success olduğunu bildirdi (iyileşme mesajı).
- Bot için ayrı journald namespace ve 7 günlük saklama kuruldu; önceki ortak
  sistem kayıtlarına dokunulmadı. Gizlilik metni tarih ayrımını açıklar.
- Azure SWA Free isteği bölge politikasıyla reddedildi. İzinli bölgeler ile
  SWA bölgeleri kesişmiyor. Ücretli kaynak açılmadan GitHub Pages'e geçildi.
- Site: https://blghnboz17-boop.github.io/dealio-public-pages/ . Yalnız onaylı
  statik dosyalar ayrı public depoda; bot deposu private. Sekiz TR/EN HTML
  sayfası HTTPS 200 döndü. Genel Discord daveti yok; sınırlı beta erişimi e-posta.
- Discord uygulamasında koşullar ve gizlilik bağlantıları bu siteye kaydedildi;
  profil açıklamasına yardım bağlantısı ve /dealio başlangıcı eklendi.

Dördüncü aşamadaki masaüstü/mobil kullanıcı kabulü ve bir haftalık gözlem henüz
geçti işaretlenmez. Yayın kapısının bu alanları boş kalır; genel erişim açılmaz.
