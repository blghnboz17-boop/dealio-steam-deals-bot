# 4. aşama — gerçek kullanıcı kabulü

Durum: başladı; kabul tamamlanmadı, genel davet kapalı.
Teknik gözlem başlangıcı: 29 Eylül 2026 23:22 Türkiye / 20:22 UTC.
İncelenen canlı revizyon: 93a1c9446dde3edf71bfbd4d1226f7ec6b07ae01.
Gerçek kullanıcı grubu başlangıcı: BEKLİYOR (ilk yeni katılımcının denemesi).
En az yedi günlük gerçek kullanım bu tarihten itibaren değerlendirilir;
boşta çalışan sunucunun geçen süresi çok kullanıcılı beta yerine sayılmaz.

## Grup ve kapsam

- Operatör: yalnız masaüstü; mobil denemesi yapılmış sayılmaz.
- Kullanıcı 2–5 arkadaş bulabileceğini belirtti; henüz katılım doğrulanmadı.
- Bu ilk küçük gruptur. Önceki yol haritasındaki onlarca kullanıcıya geçişin
  yerine sayılmaz; ilk grup sorunsuz olduktan sonra kapsam ayrıca kararlaştırılır.
- Katılımcılar B01–B05 gibi takma kodlarla kaydedilir; Discord/Steam kimliği,
  e-posta, token veya ham kişisel günlükler kanıt dosyalarına yazılmaz.
- Davetleri operatör paylaşır; ajan kimseye kendiliğinden mesaj göndermez.
- Mobil kullanabilen gönüllü bulunana kadar mobil kabul bekler.

## İlk oturum (yaklaşık 10–15 dakika)

Botun bulunduğu sunucuda veya önceden onaylı kurulum yoluyla katılınır.
1. /dealio aç: menü anlaşılır mı, düğmeler çalışıyor mu? Saati kaydet.
2. Yeni katılımcı kendi Steam wishlistini bağlasın; oyunlar ve mağaza para
   birimi kendi Steam sayfasıyla uyumlu mu? Profil/wishlist erişilemiyorsa
   açıklama anlaşılır mı? Steam şifresi istenmemeli.
3. /wishlist aç, sayfalar arasında dolaş, bir kez yenile. Yeniden hemen
   yenilediğinde bekleme bilgisi görünmeli; eski liste kaybolmamalı.
4. /test-notification çalıştır: DM geldi mi, hangi saatte? Bu yalnız DM
   kanalını sınar; gerçek indirim bildiriminin yerine sayılmaz.
5. Kullandığın cihaz/istemci, TR veya EN, sonuç, saat ve sorun açıklamasını
   operatöre ilet. Ekran görüntüsü gerekiyorsa kişisel bilgileri kapat.

## Sonraki kontrollü senaryolar

| Senaryo | TR masaüstü | EN masaüstü | Mobil | Kanıt |
|---|---|---|---|---|
| Yeni kurulum ve wishlist eşleştirme | bekliyor | bekliyor | bekliyor | katılımcı/saat/sonuç |
| Menü, sayfalama, yenileme/bekleme | bekliyor | bekliyor | bekliyor | katılımcı/saat/sonuç |
| Hedef fiyat / yüzde kuralı / susturma | bekliyor | bekliyor | bekliyor | önce/sonra, geri alma |
| Sessiz saat / günlük özet / saat dilimi | bekliyor | bekliyor | bekliyor | beklenen ve gerçek teslim saati |
| Gerçek yeni indirim bildirimi | bekliyor | bekliyor | bekliyor | Steam kontrolü, gerçek DM |
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
Günlük analiz Codex'in çalışabildiği zaman yapılır; Healthchecks alarmı ise
Codex'ten bağımsız sürekli çalışır. Otomasyon kaçırılırsa yedi günlük jurnal
saklama sınırı dikkate alınır ve kayıp gözlem açıklanır.
Sonuçlar .runtime/phase4-observation/ altında anonim JSON olarak tutulur;
önemli bulgular bu belgeye kaydedilir. Belgelenmiş kullanıcı sonucu olmadan
kabul hücreleri otomatik geçti yapılmaz.

Günlük inceleme otomasyonu: `dealio-beta-g-zlemi`, her gün 23:30
Europe/Istanbul. Değişmeyen durumda sessiz; yalnız yeni anlamlı sorun veya
kullanıcı eylemi gerektiğinde bildirir. Bu otomasyon Healthchecks'in yerine geçmez.

İlk anonim başlangıç kaydı:
`.runtime/phase4-observation/baseline-20260929.json`.
20:22–20:24:48 UTC aralığında sağlık hazır, Discord bağlantısı açık;
bu kısa aralıkta komut/tarama/DM örneği yok. Önceki başlangıç bağlamında
20:01:25 sonrası görülen 2 komut ve 1 test DM, bu yeni aralığın sonucu değildir.

## Arkadaşlara gönderilebilecek kısa test metni

Dealio için küçük bir deneme yapıyoruz. Botun bulunduğu sunucuda `/dealio`
açıp kendi Steam istek listeni bağlar mısın? Ardından `/wishlist` ile oyunların
ve para biriminin doğru göründüğünü kontrol et; `/test-notification` ile DM
gelebildiğini dene. Bilgisayar mı telefon mu kullandığını, bot dilini (TR/EN),
deneme saatini ve takıldığın yeri bildirmen yeterli. Steam şifreni paylaşma.
Veri silme veya ayar değiştirme testlerini sonraki adımda birlikte yapacağız.
