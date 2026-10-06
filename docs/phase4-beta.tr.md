# 4. aşama — gerçek kullanıcı kabulü

Durum: yedi günlük gözlem ve ilk mobil (iOS) denemesi kaydedildi (7 Ekim 2026); genel davet henüz açılmadı, karar operatörde.
Teknik gözlem başlangıcı: 29 Eylül 2026 23:22 Türkiye / 20:22 UTC.
İncelenen canlı revizyon: 93a1c9446dde3edf71bfbd4d1226f7ec6b07ae01.
Gerçek kullanıcı katılımı: doğrulandı (30 Eylül 2026 tarihli operatör bildirimi); ilk denemenin tarihi/saati netleştiriliyor.
En az yedi günlük gerçek kullanım bu tarihten itibaren değerlendirilir;
boşta çalışan sunucunun geçen süresi çok kullanıcılı beta yerine sayılmaz.

## Grup ve kapsam

- Operatör: masaüstü. 7 Ekim 2026 01:18 Türkiye saatinde bir arkadaş iPhone'da Türkçe paneli denedi (aşağıya bakın).
- Operatör 3 arkadaşın kurulumu tamamladığını ve denedikleri komutların sorunsuz çalıştığını bildirdi. Üçü de masaüstü, Türkiye mağazası ve Türkçe menü kullandı; ilk deneme zamanı henüz belirtilmedi.
- Bu ilk küçük gruptur. Önceki yol haritasındaki onlarca kullanıcıya geçişin
  yerine sayılmaz; ilk grup sorunsuz olduktan sonra kapsam ayrıca kararlaştırılır.
- Katılımcılar B01–B05 gibi takma kodlarla kaydedilir; Discord/Steam kimliği,
  e-posta, token veya ham kişisel günlükler kanıt dosyalarına yazılmaz.
- Davetleri operatör paylaşır; ajan kimseye kendiliğinden mesaj göndermez.
- Türkiye'de Discord mobil uygulaması erişime kapalı ve mağazadan kaldırıldı; mobil deneme uygulaması önceden yüklü bir katılımcıyla yapıldı.

## İlk oturum (yaklaşık 10–15 dakika)

Botun bulunduğu sunucuda veya önceden onaylı kurulum yoluyla katılınır.
1. /dealio aç: menü anlaşılır mı, düğmeler çalışıyor mu? Saati kaydet.
2. Yeni katılımcı kendi Steam wishlistini bağlasın; oyunlar ve mağaza para
   birimi kendi Steam sayfasıyla uyumlu mu? Profil/wishlist erişilemiyorsa
   açıklama anlaşılır mı? Steam şifresi istenmemeli.
3. /dealio → İstek listem sekmesini aç, sayfalar arasında dolaş, bir kez yenile. Yeniden hemen
   yenilediğinde bekleme bilgisi görünmeli; eski liste kaybolmamalı.
4. Ayarlar → Test DM gönder: DM geldi mi, hangi saatte? Bu yalnız DM
   kanalını sınar; gerçek indirim bildiriminin yerine sayılmaz.
5. Kullandığın cihaz/istemci, TR veya EN, sonuç, saat ve sorun açıklamasını
   operatöre ilet. Ekran görüntüsü gerekiyorsa kişisel bilgileri kapat.

## Sonraki kontrollü senaryolar

| Senaryo | TR masaüstü | EN masaüstü | Mobil | Kanıt |
|---|---|---|---|---|
| Yeni kurulum ve wishlist eşleştirme | 3 kişi: operatör bildirimiyle başarılı | bekliyor | bekliyor | katılımcı/saat/sonuç |
| Menü, sayfalama, yenileme/bekleme | bekliyor | bekliyor | 1 kişi iOS/TR: operatör bildirimi + ekran görüntüsü (7 Ekim 2026) | katılımcı/saat/sonuç |
| Hedef fiyat / yüzde kuralı / susturma | bekliyor | bekliyor | bekliyor | önce/sonra, geri alma |
| Sessiz saat / günlük özet / saat dilimi | bekliyor | bekliyor | bekliyor | beklenen ve gerçek teslim saati |
| Gerçek yeni indirim bildirimi | üretim günlüğü: 7 günde 31 DM, 0 başarısız (cihaz ayrımı yok) | bekliyor | bekliyor | Steam kontrolü, gerçek DM |
| Aynı teklif için yinelenen DM olmaması | bekliyor | bekliyor | bekliyor | takip eden taramalar |
| Kapalı DM / erişilemeyen wishlist hatası | bekliyor | bekliyor | bekliyor | anlaşılır hata, sonra geri alma |
| Veri silme ve yeniden kurulum | bekliyor | bekliyor | bekliyor | gönüllü onayı, sonuç |

Veri silme yalnız bunu açıkça kabul eden katılımcı üzerinde denenir. Operatörün
mevcut ayarları izinsiz silinmez; kural/saat değişiklikleri önce kaydedilip geri
alınır. Bir fiyatı veya üretim verisini değiştirerek sahte indirim oluşturulmaz.
Gerçek fiyat hareketi yoksa o satır bekler.

## Ölçüm ve bitiş kuralları

- İlk Discord yanıtı için 3 saniye sınırı. İhlal ve başarısızlıklar tek tek incelenir.
- Menü hazır olma süresi, ilk yanıt süresinden ayrıdır; kullanıcının hissettiği
  gecikme ayrıca kaydedilir. Küçük örnekte p95 başarı garantisi sayılmaz.
- Tarama süresi, Steam ürün hataları, bilinmeyen fiyatlar, kuyruk yaşı ve
  gerçek indirim tespitinden DM'ye süre gözlenir. Test DM ayrı tutulur.
- Bilinmeyen fiyatlar tek başına indirim veya hata çözümü sayılmaz. Başlangıç
  penceresindeki 1 Steam ürün hatası ve 7 bilinmeyen fiyat açıklığa kavuşturulmalı.
- Yanlış indirim veya kayıp kalıcı bildirim sıfır toleranslı kabul engelidir.
- En az yedi günlük gerçek kullanıcı gözlemi, TR/EN ve masaüstü/mobil kanıtları,
  yeni kurulum ve silme akışları tamamlanmadan genel erişim açılmaz.
- Önemli düzeltmede ilgili senaryolar tekrar denenir; stabil gözlem süresinin
  yeniden başlaması gerekip gerekmediği kayda geçirilir.
- Her ölçümün aralığı ve revizyonu kaydedilir. Eksik günlük/erişim günleri
  boşluk olarak yazılır; ölçülmeyen süre sağlıklı varsayılmaz.

## Günlük inceleme

VM ve GitHub kontrolleri salt okunur yapılır. Günlükler VM'de mevcut
scripts/metrics-report.mjs ile özetlenir; ham günlük dışarı taşınmaz.
Günlük analiz otomatik çalışmaz; operatör istediğinde yapılır. Healthchecks
alarmı ise bundan bağımsız sürekli çalışır. Yedi günlük jurnal saklama sınırı
dikkate alınır; incelenmeyen günler kayıp gözlem olarak açıklanır.
Sonuçlar .runtime/phase4-observation/ altında anonim JSON olarak tutulur;
önemli bulgular bu belgeye kaydedilir. Belgelenmiş kullanıcı sonucu olmadan
kabul hücreleri otomatik geçti yapılmaz.

Günlük inceleme otomasyonu (`dealio-beta-g-zlemi`) 3 Ekim 2026'da operatör
kararıyla kapatıldı; yerine otomasyon kurulmadı. Healthchecks'in yerini zaten tutmazdı.

İlk anonim başlangıç kaydı:
`.runtime/phase4-observation/baseline-20260929.json`.
20:22–20:24:48 UTC aralığında sağlık hazır, Discord bağlantısı açık;
bu kısa aralıkta komut/tarama/DM örneği yok. Önceki başlangıç bağlamında
20:01:25 sonrası görülen 2 komut ve 1 test DM, bu yeni aralığın sonucu değildir.

## Arkadaşlara gönderilebilecek kısa test metni

Dealio için küçük bir deneme yapıyoruz. Botun bulunduğu sunucuda `/dealio`
açıp kendi Steam istek listeni bağlar mısın? Ardından İstek listem sekmesinde oyunların
ve para biriminin doğru göründüğünü kontrol et; Ayarlar'daki Test DM ile DM
gelebildiğini dene. Bilgisayar mı telefon mu kullandığını, bot dilini (TR/EN),
deneme saatini ve takıldığın yeri bildirmen yeterli. Steam şifreni paylaşma.
Veri silme veya ayar değiştirme testlerini sonraki adımda birlikte yapacağız.

## 30 Eylül 2026 — ilk katılımcı geri bildirimi

Kaynak: operatörün bu sohbetteki bildirimi (doğrudan test gözlemi veya sunucu
metriği değildir). Üç arkadaş setup sürecini sorunsuz tamamladı; operatör tüm
komutları denediklerini ve hepsinin çalıştığını bildirdi. Tek tek komut/saat
kaydı olmadığı için bu sonuç toplu kullanıcı bildirimi olarak tutulur.

Katılım artık beklemiyor. Üçü de masaüstü, Türkiye mağazası ve Türkçe menü kullandı. İngilizce ve mobil kabul bekler; ilk deneme tarihi henüz belirtilmedi. Gerçek indirim DM'si, yinelenmeme, zamanlanmış teslim ve
veri silme için ayrı kanıt gerekir; genel “her komut çalıştı” bildirimi bu
senaryoların tamamlandığı anlamına gelmez. Yedi günlük süre tamamlanmadı.
Daha fazla gönüllü katılımı planlanıyor; genel davet kapalı kalıyor.


Ek doğrulama: üç katılımcı da bilgisayar kullandı, mağazayı Türkiye seçti ve
Türkçe menü gördü. İngilizce/mobil kabul yapılmadı. İlk deneme tarihi henüz
verilmedi; rapor tarihi 30 Eylül 2026, deneme tarihi yerine konulmaz.
Günlük inceleme otomasyonu 30 Eylül kontrolünde PAUSED durumunda bulundu;
yeniden etkinleştirilmedi (3 Ekim'de kapatıldı). Bu kayıt Healthchecks durumunu doğrulamaz.

## 7 Ekim 2026 — yedi günlük gözlem ve ilk mobil deneme

**Kullanıcı gözlemi (operatör bildirimi):** Bir hafta boyunca yaklaşık 6–7 kişi botu düzenli kullandı; bildirilen sorun yok. Bu, kişi başına senaryo kaydı değil, toplu bir bildirimdir.

**Üretim günlüğü (30 Eylül – 6 Ekim 2026, `journalctl --namespace=dealio` + `scripts/metrics-report.mjs`, VM'de salt okunur):**
- Discord ilk yanıtları: 382; 1 tanesi 3 saniyeyi aştı (gecikme isteğin bota ulaşmasından önceydi). p95 yaş 655 ms, p95 süre 462 ms.
- Panel çizimi p50 / p95: İstek listem 376 / 925 ms, Ana sayfa 385 / 791 ms, kurulum 347 / 720 ms.
- Taramalar: 336 tur, 1.828 kullanıcı taraması tamamlandı. 239 "unavailable" sonucunun tamamı wishlist'i erişilemeyen tek bir kullanıcıdan geliyor (`STEAM_WISHLIST_INACCESSIBLE`). Tarama p95 2,9 sn.
- Gerçek indirim DM'leri: 31 gönderildi, 0 başarısız. Tespitten Discord kabulüne p95 5,7 sn. Sessiz saat ve günlük özet teslimatı örneği yok.
- 6 Ekim veritabanı kontrolünde aynı kullanıcı ve oyun için birden fazla gönderilmiş DM yok. Örnek küçük olduğu için yinelenme satırı bekliyor olarak kalır; 200 kullanıcılık sentetik yük testi de 0 yinelenme gösterdi (`docs/evidence/capacity-2026-10-07-200-users.json`).

**Mobil (iOS, Türkçe, Türkiye mağazası):** 7 Ekim 2026 01:18 Türkiye saatinde bir katılımcı telefondan paneli denedi. Operatör, her düğmenin çalıştığını ve açıldığını bildirdi. Ekran görüntüsü (yalnız operatörle paylaşıldı, depoya eklenmedi) İstek listem ekranını gösteriyor: başlık, oyun kartları, görseller, fiyat/indirim rozeti ve "Yakında" etiketi sığıyor; dört sekme mobilde 2+2 satıra bölünüyor ve okunuyor. Kişi başına adım kaydı ve Android denemesi yok.

**Hâlâ bekleyen:** İngilizce/Almanca/Fransızca istemci, Android, zamanlanmış teslim (sessiz saat/günlük özet), yeterli örnekle yinelenmeme, gönüllüyle veri silme ve yeniden kurulum. Genel davet kararı operatörün onayına bağlıdır.
