<p align="center">
  <img src="docs/assets/dealio-onboarding-banner.png" alt="Dealio — koyu zemin üzerinde mavi fiyat etiketi ve kalp" width="960">
</p>

<h1 align="center">🎮 Senin Wishlist’in. Senin kuralların.</h1>

<p align="center">
  Discord’daki kişisel Steam fiyat asistanın.<br>
  Fiyatını seç. Bildirim zamanını belirle. Gerisini Dealio takip etsin.
</p>

<p align="center">
  <a href="https://blghnboz17-boop.github.io/dealio-public-pages/"><img src="https://img.shields.io/badge/Beta%E2%80%99ya_kat%C4%B1l-5865F2?style=for-the-badge&amp;logo=discord&amp;logoColor=white" alt="Beta’ya katıl"></a>
  <a href="#komutlar"><img src="https://img.shields.io/badge/Komutlar%C4%B1_ke%C5%9Ffet-1B2838?style=for-the-badge&amp;logo=steam&amp;logoColor=white" alt="Komutları keşfet"></a>
  <a href="#son-gelismeler"><img src="https://img.shields.io/badge/Son_geli%C5%9Fmeler-8B5CF6?style=for-the-badge" alt="Son gelişmeler"></a>
</p>

<p align="center">
  <a href="#komutlar"><img src="https://img.shields.io/badge/Steam-wishlist_takibi-171D25?style=flat-square&amp;logo=steam&amp;logoColor=white" alt="Steam-wishlist takibi"></a>
  <a href="README.md"><img src="https://img.shields.io/badge/T%C3%BCrk%C3%A7e-English-2980B9?style=flat-square" alt="Türkçe-English"></a>
  <a href="#discordda-başla"><img src="https://img.shields.io/badge/Kurulum-Steam_%C5%9Fifresi_gerekmez-238636?style=flat-square" alt="Kurulum-Steam şifresi gerekmez"></a>
</p>

<p align="center">
  <a href="https://github.com/blghnboz17-boop/steam-wishlist-discord-bot/releases/tag/v0.1.0-beta.1"><img src="https://img.shields.io/badge/Beta-v0.1.0--beta.1-8B5CF6?style=flat-square" alt="Sınırlı beta v0.1.0-beta.1"></a>
  <a href="https://github.com/blghnboz17-boop/steam-wishlist-discord-bot/actions/workflows/ci.yml"><img src="https://img.shields.io/badge/CI-Testleri_g%C3%B6r-238636?style=flat-square&amp;logo=github" alt="GitHub testlerini görüntüle"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/Lisans-MIT-2980B9?style=flat-square" alt="MIT"></a>
</p>

---

## 🎮 Daha az kontrol. Daha çok oyun.

Wishlist’ine bir oyun ekledin ama şu anki fiyatı sana fazla geliyor. Dealio’ya hangi fiyatta haber almak istediğini söyle; Steam’i belirli aralıklarla kontrol edip koşulların oluştuğunda sana Discord’dan DM göndersin.

Her oyun için ayrı hedef belirleyebilir, gece bildirim istemiyorsan sessiz saatlerini seçebilirsin. Listeye bakmak veya bir ayarı değiştirmek için `/dealio` yazman yeterli.

| 🎯 Senin fiyatın | 🔕 Senin zamanın | 📊 Fiyatın geçmişi |
| :--- | :--- | :--- |
| Her oyun için hedef fiyat veya indirim eşiği belirle. Bildirim istemediğin oyunu sustur. | Tespit edilince bildirim al, sessiz saatler seç veya günlük özete geç. | Steam’in bölgesel para birimini, gözlemlenen fiyatları ve bildirimin neden geldiğini incele. |

## 👀 Discord’da nasıl görünüyor?

<table>
  <tr>
    <td width="50%" valign="top"><strong>🏠 Dealio · ana panel</strong><br><br><a href="docs/assets/screenshots/dealio-home-desktop.png"><img src="docs/assets/screenshots/dealio-home-desktop.png" alt="Dealio ana paneli: Black Flag oyun kapağı, kurala uygun indirim ve wishlist, bildirim zamanı, geçmiş kontrolleri" width="380"></a></td>
    <td width="50%" valign="top"><strong>🎮 Wishlist · oyunlar ve fiyat kuralları</strong><br><br><a href="docs/assets/screenshots/wishlist-desktop.png"><img src="docs/assets/screenshots/wishlist-desktop.png" alt="Discord masaüstünde Dealio wishlist paneli: oyunlar, fiyatlar ve bildirim kontrolleri" width="300"></a><br><br><strong>📬 İndirim geldiğinde DM kutunda</strong><br><br><a href="docs/assets/screenshots/sale-dm-example.png"><img src="docs/assets/screenshots/sale-dm-example.png" alt="Outbound için önceki bir indirim DM örneği: fiyat, indirim yüzdesi ve tasarruf" width="380"></a></td>
  </tr>
</table>

<sub>Kullanıcı tarafından paylaşılan gerçek Discord ekranları; arayüz dili İngilizce. DM görseli 22 Eylül 2026’dan bir örnektir; fiyat ve bazı arayüz ayrıntıları güncel sürümden farklı olabilir.</sub>

### ✨ İçeride neler var?

- 🏠 **Her şey tek panelde.** Oyun kapakları, kurallarına uyan indirimler, bildirim ayarları ve geçmiş.
- 🎮 **Listende kolayca gezin.** Oyun ara, filtrele, üçer oyunluk sayfalarda dolaş veya bir oyunun detayını aç.
- 🎯 **Her oyuna ayrı karar ver.** Genel indirim eşiğini kullan, o oyuna özel bir yüzde seç ya da doğrudan fiyat yaz. İlgilenmediğin oyunu sustur.
- 📬 **Bildirimini takip et.** Bekleyen ve gönderilen DM’leri gör. Mesaj alamıyorsan test bildirimiyle kontrol et; gönderim kaydı mesajın okunduğu anlamına gelmez.
- 📊 **Fiyatın zamanla nasıl değiştiğine bak.** Bildirimler ve oyun detayı, mağaza bölgendeki Steam en düşük fiyatını gösterir (IsThereAnyDeal’dan, yalnızca aynı para biriminde); oyun detayında son fiyat değişiklikleri de yer alır. Dealio kendi fiyat gözlemlerini 90 gün tutar.
- 👤 **Baştan başlamadan hesap değiştir.** Steam hesabını ⚙️ Ayarlar’dan, kurulumdaki profil penceresiyle değiştir; genel indirim oranın, bildirim zamanlaman ve dilin aynı kalır.
- 🌍 **Türkçe, İngilizce, Almanca ya da Fransızca kullan.** Kurulumdan bildirimlere kadar dört dil de mevcut; metinler samimi bir dille ve her dilde Steam’in kendi terimleriyle (ör. istek listesi) yazıldı. Almanca ve Fransızca yeni; henüz gerçek kullanıcı denemesinden geçmedi.

<a name="son-gelismeler"></a>

## ✨ Son gelişmeler

> **4 Ekim 2026 · Hesap değiştirme ve daha sağlam bildirimler**
>
> Steam hesabını artık verilerini silmeden ⚙️ Ayarlar’dan değiştirebilirsin. Steam bir oyunu istek listenden kısa süreliğine düşürürse, oyun geri geldiğinde Dealio bunu yeni indirim saymıyor; böylece aynı indirim için ikinci DM gelmiyor. İndirim DM’lerinde artık yalnızca panel butonu var; isteğe bağlı destek bağlantısı ana panele taşındı. Beta tek sunucuda çalıştığı için yeni kayıt sayısı sınırlı.

> **30 Eylül 2026 · Sınırlı beta, ilk kullanıcılar**
>
> Üç kişi bilgisayarda, Türkiye mağazası ve Türkçe menülerle kurulumu tamamladı. Denedikleri komutlarda sorun bildirmediler. Şimdi günlük kullanımda bildirimleri ve olası aksaklıkları takip ediyoruz.

Bildirim güvenilirliği ve beta hazırlıkları bu sürümde bir araya geldi. [v0.1.0-beta.1 sürüm notları →](https://github.com/blghnboz17-boop/steam-wishlist-discord-bot/releases/tag/v0.1.0-beta.1)


<a name="discordda-başla"></a>

## 🚀 Discord’da başla

Dealio şu an küçük bir grupla deneniyor. Katılmak istersen [beta sayfasından](https://blghnboz17-boop.github.io/dealio-public-pages/) ulaşabilirsin. Kullanım ücretsiz; genel daveti testler tamamlandığında açacağız. Betada yer sınırlı; yerler dolduğunda `/setup` bunu söyler ve hiçbir şey kaydetmez.

1. **Botun bulunduğu sunucuya katıl.** Davet bilgilerini beta katılımı sırasında paylaşacağız.
2. **`/setup` yaz.** Dilini seç; Steam profil bağlantını, özel URL adını veya SteamID64’ünü gir; gerçek Steam Store ülkeni doğrula, ardından indirim DM’lerini açıkça onayla.
3. **`/dealio` aç.** Wishlist’ini incele, bir oyun seç ve istediğin fiyatı belirle.

İstek listenin okunabilmesi için Steam profilin ve “Oyun ayrıntıları” herkese açık olmalı; Discord, bottan DM almana izin vermeli. Dealio Steam şifreni, çerezlerini veya giriş oturumunu istemez.

## 🔔 Bildirimler ne zaman gelir?

Dealio, her tarama bittikten **30 dakika sonra** yeniden kontrol eder. Kuralına uyan bir fiyat değişimi olduğunda, seçtiğin bildirim zamanına göre DM gönderir. Steam veya Discord’da sorun varsa gecikme olabilir.

İlk kurulum mevcut indirimlerin bir özetini gönderebilir; hepsi için ayrı yeni-indirim bildirimi oluşturmaz. Bir oyun kuralına zaten uyarken kural kaydetmek ya da genel indirim oranını değiştirmek de DM göndermez; o indirim belirgin şekilde iyileşirse (en az 10 puan daha fazla indirim ya da tutturulmuş hedefte %10 daha düşük fiyat) haber verir. Fiyatlar seçtiğin Steam mağazasının para birimindedir; satın alırken son fiyatı Steam’de kontrol et.

<a name="komutlar"></a>

## 💬 Komutlar

| Komut | İşlev |
| :--- | :--- |
| `/dealio` | Ana ekran: fırsatlar, takip ve kişisel kontroller |
| `/setup` | Steam profilini bağla, tercihlerini belirle |
| `/wishlist` | Oyun ara, hedef belirle, sustur ve fiyat gözlemlerini incele |
| `/status` | Hesap, genel indirim eşiği ve bildirim durumu |
| `/check` | Kısa bekleme sınırına tabi olarak kontrol iste |
| `/region` | Steam Store ülkeni seç |
| `/test-notification` | Wishlistinde şu an indirimde olan bir oyunla kendine test bildirimi gönder |
| `/delete-data` | Onayından sonra aktif hesap verilerini sil |

Silme dışındaki her şey `/dealio` panelinde de var: 🏠 Ana sayfa, 🎮 İstek listem, 🔔 Bildirimler ve ⚙️ Ayarlar. Bölgeni, dilini ya da Steam hesabını Ayarlar’dan değiştirebilirsin.

Paneller sana özeldir; düğmeler paneli açan kullanıcıya bağlıdır. Süre dolunca veya bot yeniden başlayınca yeni bir komut açarak devam edebilirsin.

<a name="beta-durumu"></a>

## 🧪 Beta durumu

Üç kişi Türkçe masaüstü kurulumu ve komut denemelerini sorunsuz tamamladığını bildirdi. Şimdi en az yedi günlük gerçek kullanımı izliyoruz. İngilizce, mobil ve uzun süreli bildirim kontrolleri tamamlanmadan genel daveti açmayacağız.

## 🔒 Verilerin ve kontrolün

Dealio hesap kimliklerini, tercihlerini, oyun kurallarını, gözlemlenen wishlist fiyatlarını ve teslimat kayıtlarını tutar. Normal Discord mesajlarının içeriğini veya Steam giriş bilgilerini toplamaz.

Bildirim geçmişi son **30 günü** gösterir; fiyat gözlemleri **90 gün** tutulur. Aktif teslimat ve devam eden tekliflerin tekrarını önleyen kayıtlar daha uzun kalabilir. `/delete-data` aktif hesap kayıtlarını siler. Mevcut yedek kopyaları yeniden yazılmaz; ancak ayrı tutulan bir silme kaydı (Discord kimliğinin tek yönlü özeti, 35 gün saklanır) yedekten geri dönülse bile verilerinin geri gelmemesini sağlar.

[Gizlilik](https://blghnboz17-boop.github.io/dealio-public-pages/privacy-tr.html) · [Kullanım koşulları](https://blghnboz17-boop.github.io/dealio-public-pages/terms-tr.html) · [Yardım](https://blghnboz17-boop.github.io/dealio-public-pages/help-tr.html)

## ❓ Sık sorulanlar

<details>
<summary><strong>“Failed” veya “Başarısız” hatası aldım. Ne yapabilirim?</strong></summary>

Bu mesaj tek başına nedenini söylemez; yanlış bir şey yaptığın anlamına da gelmez. Steam fiyatlara yanıt verememiş, Discord işlemi tamamlayamamış veya Dealio tarafında bir sorun çıkmış olabilir. Varsa mesajdaki ayrıntı bize daha çok şey söyler.

Biraz bekleyip komutu bir kez daha dene; bekleme süresi gösteriliyorsa dolmasını bekle. Eski paneldeki düğme çalışmıyorsa `/dealio` ile yeni bir panel aç. Sorun devam ederse [yardım sayfasından](https://blghnboz17-boop.github.io/dealio-public-pages/help-tr.html) kullandığın komutu, yaklaşık saati ve hata metnini paylaş. Ekran görüntüsündeki kişisel bilgileri gizlemen yeterli; kurulumu hemen silip baştan yapmana gerek yok.

</details>

<details>
<summary><strong>Bot çalışıyor ama DM gelmiyor. Neyi kontrol etmeliyim?</strong></summary>

Önce `/test-notification` ile bir örnek mesaj iste. O da gelmiyorsa botu engellemediğini ve ortak sunucudan DM almaya izin verdiğini kontrol et. Bildirimler DM engeli nedeniyle duraklatılmışsa ayarı düzelttikten sonra `/dealio` → ⚙️ Ayarlar üzerinden yeniden aç.

Test mesajı geliyor ama indirim bildirimi gelmiyorsa `/dealio` → ⚙️ Ayarlar içindeki bildirim durumuna, oyunun hedef fiyatına veya indirim eşiğine, susturma seçeneğine ve sessiz saat/günlük özet ayarlarına bak. Test DM’si mesaj alabileceğini gösterir; her oyunun o anda bildirim koşulunu karşıladığı anlamına gelmez.

</details>

<details>
<summary><strong>Steam profilim bulundu ama wishlist’im açılmıyor. Neden?</strong></summary>

Profil bağlantısının doğru olduğundan ve wishlist’inin dışarıdan görülebildiğinden emin ol. Bunu Steam hesabına giriş yapmadığın bir tarayıcı penceresinde kendi wishlist bağlantını açarak kontrol edebilirsin; profilin görünmesi tek başına yeterli olmayabilir.

Steam gizlilik ayarlarını değiştirdiysen biraz bekleyip yeniden dene. Liste dışarıdan açıldığı hâlde Dealio hâlâ okuyamıyorsa Steam geçici olarak yanıt vermiyor olabilir. Tekrar denediğinde de düzelmiyorsa [bize haber ver](https://blghnboz17-boop.github.io/dealio-public-pages/help-tr.html); Steam şifreni veya oturum bilgilerini paylaşma.

</details>

<details>
<summary><strong>Hedef belirledim. Neden hemen DM gelmedi?</strong></summary>

Kural kaydı başlangıç durumunu belirler. Zaten uygun olan teklif panelde gösterilir; fiyat %10 daha düşerse ya da hedefinin üstüne çıkıp yeniden inerse DM gelir. Oyunun kuralını, susturma durumunu ve bildirim zamanını kontrol et. Mağaza bölgenin para birimi değiştiyse hedefi yeniden kaydet; o zamana kadar genel indirim kuralın geçerli.

</details>

<details>
<summary><strong>Başka bir Steam hesabına nasıl geçerim?</strong></summary>

`/dealio` → ⚙️ Ayarlar → **Steam hesabını değiştir**’e bas. Kurulumdaki profil penceresinin aynısı açılır; Dealio yeni hesabı gösterir ve ancak onaylarsan değiştirir. Genel indirim oranın, bildirim zamanlaman ve dilin aynı kalır. Eski hesabındaki oyunlara koyduğun kurallar, hedefler ve bekleyen bildirimler taşınmaz; yeni listende zaten indirimde olan oyunlar için bildirim gelmez. Bunun için artık `/delete-data` gerekmez.

</details>

<details>
<summary><strong>Kurulumumu silmeden bildirimleri durdurabilir miyim?</strong></summary>

Evet. `/status` içindeki bildirim düğmesini kullan. Ayarların korunur. Otomatik bildirimler kapalıyken manuel `/check` çalışmaya devam eder.

</details>

<details>
<summary><strong>Aynı bildirim iki kez gelebilir mi?</strong></summary>

Dealio gönderdiği bildirimi kaydeder ve aynı teklif için normal kontrollerde tekrar mesaj atmaz. Steam bir oyunu istek listenden kısa süreliğine düşürürse oyun bir süre indirim durumunu korur; geri geldiğinde yeni indirim sayılmaz. Yine de Discord mesajı kabul edip yanıtı kaybolursa yeniden deneme çift mesaj oluşturabilir. Böyle bir durum görürsen bildirebilirsin.

</details>

## 🛠️ Geliştirme ve işletim

TypeScript · discord.js Components V2 · SQLite · Azure VM

- [Geliştirme rehberi](docs/development.md) — ayrı test kurulumu, ayarlar ve kontroller
- [Mimari](docs/architecture.md) — fiyatlar, kurallar, teslimat ve veri
- [Mevcut işletim düzeni](deploy/FREE-OPERATIONS.tr.md) — ücretsiz yedek, alarm ve kurtarma
- [GitHub kontrolleri](https://github.com/blghnboz17-boop/steam-wishlist-discord-bot/actions/workflows/ci.yml) — güncel doğrulamalar

İlk sürüm Steam wishlist’lerine odaklanır. Ödeme sistemi, ayrı web yönetim paneli, diğer mağazalar ve tahmini para birimi dönüşümü kapsam dışındadır.

<details>
<summary><strong>Teknik ayrıntılar ve beta kontrol listesi</strong></summary>

## 🔔 Bildirimler nasıl çalışır?

**Kontroller 30 dakikalık düzende yapılır; Steam’den anlık olay akışı alınmaz.** Bir sonraki otomatik tarama, önceki tarama bittikten 30 dakika sonrasına planlanır. Steam veya Discord kesintileri gecikme yaratabilir.

| Adım | Ne olur? |
| :--- | :--- |
| Gözlemle | Seçtiğin ülke ve dil için Steam fiyatları alınır. Başarılı oyun fiyatı sorguları beş dakikalık ortak önbelleği kullanır; gerçek gözlem zamanı korunur. |
| Karşılaştır | Oyunun hedef fiyatı veya indirim kuralı değerlendirilir. Alınamayan fiyat, fırsat olarak yorumlanmaz. |
| Gerekirse beklet | Sessiz saatler, günlük özet veya teslimat tekrarları için uygun bildirimler kalıcı kuyrukta tutulur. |
| Doğrula ve ilet | Gönderim öncesi bekleyen fırsatların fiyatı tekrar kontrol edilir. Bittiği doğrulanan teklif gönderilmez. |

Kurulum başlangıç durumunu kaydeder ve ayrıca bir wishlist özeti gönderebilir. Zaten indirimdeki her oyun için ayrı yeni-indirim bildirimi oluşturmaz. Mevcut fiyatın zaten karşıladığı bir hedefi kaydetmek de başlangıç bildirimi üretmez.

Fiyatlar Steam’in bildirdiği para biriminde kalır; tahmini kur dönüşümü yapılmaz. Hedef fiyat para birimine bağlıdır; ülke/para birimi değişince yeni hedef gerekebilir. Satın almadan önce Steam’deki ödeme fiyatını doğrula.

## 🧪 Beta durumu

Bot mevcut Azure VM’de çalışıyor. **Şu an gerçek kullanıcı denemesi aşamasındayız; genel kullanım kabulü henüz tamamlanmadı.**

- [x] İlk kullanıcılarla Türkçe masaüstü kurulumu ve komut denemeleri
- [x] Şifreli uzak yedek, geri yükleme ve bağımsız alarmın denenmesi
- [x] Yardım, gizlilik ve kullanım koşullarının yayımlanması
- [ ] En az yedi günlük gerçek kullanım gözlemi
- [ ] Gerçek indirim, zamanlanmış teslim ve tekrar bildirim kontrolleri
- [ ] İngilizce, mobil ve onaylı veri silme denemeleri

[Yol haritası ve kabul notları →](docs/phase4-beta.tr.md)


</details>

---

<p align="center">
  <a href="https://github.com/blghnboz17-boop">Bilgehan</a> tarafından geliştiriliyor. 💙 · <a href="LICENSE">MIT lisansı</a> · Kaynak repo özeldir.<br>
  <sub>Dealio bağımsız bir projedir; Valve veya Discord ile bağlantılı değildir.</sub>
</p>
