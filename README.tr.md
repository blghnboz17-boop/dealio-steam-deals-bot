# 🎮 Dealio

> 🌐 **Language / Dil:** [🇺🇸 English](README.md) · [🇹🇷 Türkçe](README.tr.md)

**Steam istek listenizi izleyen bir Discord botu — bir oyun gerçekten indirime girdiği anda size özel mesaj gönderir; bölge, para birimi, indirim oranı ve fiyatın alındığı zaman mesajın içinde yazar, böylece Discord'dan çıkmadan karar verirsiniz.**

![Discord](https://img.shields.io/badge/Discord-Sunucuna%20ekle-5865F2?logo=discord&logoColor=white)
![Steam](https://img.shields.io/badge/Steam-istek%20listesi%20takibi-000000?logo=steam&logoColor=white)
![Diller](https://img.shields.io/badge/diller-T%C3%BCrk%C3%A7e%20%C2%B7%20English-informational)
![Kurulum](https://img.shields.io/badge/kurulum-%C5%9Fifre%20gerektirmez-success)
![Lisans](https://img.shields.io/badge/lisans-MIT-blue)

---

> ⚠️ **Uyarı:** Dealio bağımsız bir projedir; **Valve Corporation veya Discord Inc. ile bağlantılı değildir, onlar tarafından desteklenmez veya sponsor edilmez.** Yalnızca **herkese açık** Steam istek listesi verisini okur; Steam şifrenizi, çerezlerinizi veya giriş bilgilerinizi asla istemez. Fiyatlar doğrudan Steam'den gelir ve olduğu gibi gösterilir — satın almadan önce nihai fiyatı mutlaka Steam mağaza sayfasından doğrulayın.

---

## 🚀 Nasıl Başlarım

İndirme yok. Terminal yok. Steam girişi yok. Üç adım:

### 1️⃣ Dealio'yu sunucuna ekle

👉 **[Dealio'yu Discord'a Ekle](https://discord.com/oauth2/authorize?client_id=1540325119690412172&scope=bot+applications.commands&permissions=0)**

### 2️⃣ `/setup` yaz

Sadece senin görebileceğin özel bir sihirbaz açılır. İki şey sorar:

| Alan | Ne yazacaksın |
|---|---|
| **Steam profili** | SteamID64'ün, profil linkin ya da sadece kullanıcı adın |
| **Mağaza ülkesi** | Listeden seçilir — Dealio, Discord diline bakarak bir tahmin önceden işaretler |

Profil alanına aşağıdakilerin hepsi yazılabilir:

```text
76561198012345678                                  ← SteamID64
https://steamcommunity.com/profiles/765611980...   ← profil linki
https://steamcommunity.com/id/kullaniciadi         ← özel isim linki
kullaniciadi                                       ← sadece isim
```

### 3️⃣ İndirim DM'lerini aç

Dealio istek listenin okunabildiğini doğrular, sana bir onay kartı gösterir ve **sen özel mesajları açıkça onaylayana kadar hiçbir şey kaydetmez.**

Hepsi bu. Bundan sonra Dealio istek listeni arka planda izler.

---

## ✅ Başlamadan Önce

Sadece iki şeyin doğru olması yeterli:

| Gereksinim | Nasıl kontrol edilir |
|---|---|
| **Steam profilin herkese açık** | Steam → Profil → Profili Düzenle → Gizlilik Ayarları → **Oyun ayrıntıları**'nı *Herkese Açık* yap |
| **Discord DM'lerin açık** | Sunucu ayarları → Gizlilik Ayarları → sunucu üyelerinden özel mesaja izin ver |

> Dealio yalnızca zaten herkese açık olanı okuyabilir. Steam şifreni, çerezini, oturumunu veya herhangi bir giriş bilgini asla istemez.

---

## ✨ Dealio'yu Farklı Kılan Ne

- **Asla uydurma indirim üretmez.** Steam bilinmeyen bir fiyat döndürdüğünde, tek bir oyun için hata verdiğinde veya komple çöktüğünde Dealio bunu neyse o olarak kaydeder. Bir hata asla "indirimde!" mesajına dönüşmez.
- **Senin bölgen, senin fiyatın.** Dealio ayarladığın Steam Mağaza ülkesini kullanır; gördüğün fiyat *senin* gerçekten ödeyeceğin fiyattır — kafanda çevirmen gereken bir Amerika rakamı değil.
- **İlk çalıştırma sessizdir.** Dealio'yu kurmak sana 200 tane DM yağdırmaz. İstek listene ilk bakış sessiz bir başlangıç noktasıdır; uyarılar bundan sonraki gerçek değişikliklerle başlar.
- **İndirim başına tek uyarı.** Kontrol başına değil. Bir oyun iki hafta indirimdeyse bunu bir kere duyarsın.
- **Sınırı sen koyarsın.** Her şey için genel bir alt indirim sınırı, artı daha çok önemsediğin oyunlar için ayrı eşikler.
- **Hiçbir şey kaybetmeden duraklat.** Bildirimleri kapat; istek listen, eşiklerin ve geçmişin olduğu gibi kalır.
- **Onayın olmadan hiçbir şey olmaz.** Sen onaylayana kadar veri kaydedilmez, `/delete-data` ise istediğin an hepsini siler.
- **Türkçe ve İngilizce.** Doğru biçimlendirilmiş yerel fiyatlar dahil, iki dilde tam arayüz.

---

## 💬 Komutlar

| Komut | Ne yapar |
|---|---|
| `/dealio` | Ana kontrol panelini açar |
| `/setup` | Tek seferlik kurulum sihirbazı (Steam profili + Mağaza ülkesi) |
| `/status` | Hesabın, takip durumun, bildirim ayarların ve son kontrolün |
| `/wishlist` | İstek listeni sayfa başına üç oyun gezdirir, oyun bazlı eşik ayarlatır |
| `/check` | Sıradaki kontrolü beklemeden hemen şimdi kontrol eder |
| `/region` | Steam Mağaza ülkeni değiştirir |
| `/test-notification` | Uyarının nasıl göründüğünü görmen için örnek bir indirim mesajı yollar |
| `/delete-data` | Dealio'nun senin hakkında bildiği her şeyi siler |

> Her panel sana özeldir ve kendiliğinden zaman aşımına uğrar. Butonlar yalnızca paneli açan kişiye cevap verir.

---

## 🔔 Uyarı Nasıl Görünür

Bir oyun eşiğini geçtiğinde şunları içeren bir DM alırsın:

- 🎮 **Oyun adı**
- 💸 **Eski fiyat → indirimli fiyat**, bölgenin para biriminde
- 📉 **İndirim yüzdesi**
- 🌍 **Fiyatın alındığı Mağaza bölgesi**
- 🕐 **Fiyatın ne zaman gözlendiği**
- 🔗 **Steam sayfasına doğrudan bağlantı**

Aynı anda indirime giren birden fazla oyun, indirime göre sıralanmış **tek bir mesajda** gruplanır — beş ayrı DM olarak değil.

**Fiyatlar asla dönüştürülmez.** Dealio, Steam'in senin bölgen için bildirdiği fiyatı, o bölgenin para biriminde aynen gösterir. Kur tahmini yapmaz.

---

## ⚙️ Nasıl Çalışır

```
        Steam istek listen (herkese açık)
                    │
                    ▼
        Dealio 30 dakikalık aralıklarla kontrol eder
                    │
                    ▼
   ┌────────────────────────────────────┐
   │  Bu gerçek, doğrulanmış bir indirim│
   │  mi?                               │
   │  ✅ evet → senin sınırını geçti mi?│
   │  ❓ fiyat bilinmiyor → bekle, sorma│
   │  ⚠️ Steam hatası → bekle, sorma    │
   └────────────────┬───────────────────┘
                    │  ikisine de evet
                    ▼
     Teslimat kuyruğuna alınır (yeniden başlatmadan sağ çıkar)
                    │
                    ▼
              📬 Sana özel mesaj
```

Kontrol döngüsü ile teslimat döngüsü **ayrı** çalışır; böylece bir Discord aksaklığı Steam'in kontrol edilmesini asla durduramaz, bir Steam kesintisi de kuyruğa girmiş bir mesajı asla engelleyemez.

Bir teslimat geçici olarak başarısız olursa Dealio aralıkları büyüterek yeniden dener ve beş denemeden sonra vazgeçer. DM'lerin kapalıysa bu kalıcı bir durumdur — denemeyi bırakır ve `/status` üzerinde sana bildirir.

---

## 🔒 Verilerin

**Dealio'nun sakladıkları:** Discord kullanıcı kimliğin, herkese açık SteamID64'ün, seçtiğin Mağaza ülkesi ve dil, bildirimlerin açık olup olmadığı, indirim eşiklerin, istek listendeki oyunlar ve gözlenen fiyatları, bildirimlerinin teslimat durumu.

**Dealio'nun asla saklamadıkları:** Steam şifreleri, çerezler, giriş bilgileri, Discord mesajların, yazdığın kullanıcı adı veya yapıştırdığın ham profil linki.

**Her şeyi silmek:** `/delete-data` komutunu çalıştır ve onay kutusunu işaretle. Yapılandırmanı, istek listesi durumunu, indirim geçmişini ve bildirim kayıtlarını birlikte, SQLite'ın güvenli silme kipiyle kaldırır. Onayı kapatmak veya iptal etmek hiçbir şeyi değiştirmez.

📄 Ayrıntılar: [Gizlilik Politikası](docs/privacy.html) · [Kullanım Koşulları](docs/terms.html)

---

## ❓ Sıkça Sorulanlar

<details>
<summary><b>Kurdum ama hiç mesaj gelmedi, bozuk mu?</b></summary>

Muhtemelen değil. İstek listene ilk bakış **sessiz bir başlangıç noktasıdır** — Dealio zaten indirimde olanları sana mesaj atmadan kaydeder, böylece ilk gün boğulmazsın. Bundan sonra *değişen* bir şey olduğunda haber alırsın.

Ayrıca `/status`'a bak — genel alt indirim sınırın yüksekse, altında kalan oyunlar elenir.
</details>

<details>
<summary><b>Dealio istek listemi okuyamadığını söylüyor.</b></summary>

Steam profilindeki **Oyun ayrıntıları** ayarı *Herkese Açık* olmalı. Steam → Profil → Profili Düzenle → Gizlilik Ayarları. "Sadece arkadaşlar" yeterli değildir — Dealio senin Steam arkadaşın değildir ve olmayı da istemez.
</details>

<details>
<summary><b>Gösterilen fiyat Steam'de gördüğümden farklı.</b></summary>

`/status` ile hangi Mağaza ülkesinin ayarlı olduğuna bak. Yanlışsa `/region` ile düzelt. Bölge değiştirmek her şeyi sıfırlar — eski fiyatlar yenileriyle asla karşılaştırılmaz ve yeni bir sessiz başlangıç noktası oluşur.
</details>

<details>
<summary><b>Aynı oyun iki kere geldi.</b></summary>

Nadir ama mümkün. Discord mesajı kabul edip onay yolda kaybolursa Dealio mesajın ulaşıp ulaşmadığını bilemez ve tekrar deneyebilir. İki kere göndermeyi, uyarıyı tamamen kaybetmeye tercih ediyoruz — ve olamazmış gibi davranmak yerine bunu açıkça yazıyoruz.
</details>

<details>
<summary><b>Kurulumumu kaybetmeden bildirimleri nasıl durdururum?</b></summary>

`/status` üzerindeki bildirim düğmesini kullan. İstek listen, eşiklerin ve geçmişin olduğu gibi kalır. Bildirimler kapalıyken elle `/check` çalışmaya devam eder. İstediğin zaman geri açarsın.
</details>

<details>
<summary><b>Komutlar sunucumda görünmüyor.</b></summary>

Dealio'nun komutları global olarak kayıtlıdır ve Discord'un bunları her yere yayması bir saati bulabilir. Biraz sonra tekrar dene.
</details>

<details>
<summary><b>İstek listem ne sıklıkla kontrol ediliyor?</b></summary>

Dealio varsayılan olarak **her tamamlanan taramadan sonra 30 dakika bekler** (`POLL_INTERVAL_HOURS=0.5`) ve yeniden kontrol eder. Eşiği karşılayan indirim tespit edilince bildirim gönderilir. Tarama süresi ve Steam/Discord kesintileri gecikmeyi artırabilir; anlık teslim garantisi yoktur. `/check` ile kullanıcı başına kısa bekleme süresine tabi olarak hemen kontrol başlatabilirsin.
</details>

<details>
<summary><b>Sadece büyük indirimlerde haber alabilir miyim?</b></summary>

Evet. `/status` üzerinden genel bir alt sınır belirle, sonra `/wishlist` ile tek tek oyunlara kendi eşiklerini ver. Oyuna özel değer genel değerin yerine geçer.
</details>

---

## 🗺️ Yol Haritası

| Sırada | |
|---|---|
| 🎯 **Hedef fiyat** | "Şu fiyatın altına düşerse haber ver" |
| 📊 **Tarihsel dip** | Bunun gerçekten şimdiye kadarki en iyi fiyat olup olmadığını gör |
| 🏷️ **Fiyat değişim türü** | Gerçek indirim · kalıcı fiyat düşüşü · bölgesel değişim — net biçimde ayrılmış |
| 💱 **Yaklaşık yerel maliyet** | Kur ve zaman damgası gösterilerek, Steam fiyatıyla asla karıştırılmadan |
| 🔕 **Sessiz saatler & özetler** | Anlık yerine toplu uyarılar, senin belirlediğin saatlerde |
| 👥 **Sunucu özetleri** | İsteğe bağlı, düşük gürültülü kanal özetleri |

**Bilinçli olarak asla:** Steam şifreni veya çerezini istemek · sonuçlara yetkisiz anahtar satıcıları koymak · sponsorlu yerleşimi "en iyi fırsat" sıralamasına karıştırmak.

---

## 👤 Yapımcı

**[@blghnboz17-boop](https://github.com/blghnboz17-boop)** tarafından yapılmıştır

Teknik mimari [`docs/architecture.md`](docs/architecture.md) dosyasında belgelenmiştir.

---

## 📄 Lisans

MIT — [LICENSE](LICENSE) dosyasına bakın

## Tasarım önizlemesi

`npm run preview:ui` komutu, botun gerçek arayüz bileşenlerini örnek verilerle
`.runtime/ui-preview.html` dosyasına çıkarır. Türkçe/İngilizce ve dar ekran seçenekleri
vardır. Bu yerel önizleme Discord'a bağlanmaz ve bildirim göndermez. Discord içindeki
son görünüm ve etkileşim kontrolü ayrıca yapılmalıdır.
