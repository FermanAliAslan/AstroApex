# AstroApex · Lunar Landing Site Navigator

English version: [README.md](README.md). Site İngilizce açılır; TR tuşu Türkçeye çevirir.

NASA Space Apps Challenge 2026 — Ay iniş sahalarını ve tarihlerini karşılaştıran görev planlama aracı.
Güneş (güç) ve Dünya’nın (doğrudan iletişim) yerel ufka göre konumunu, görüş pencerelerini,
uygunluk skorunu, yakıt ve batarya tahminlerini gösterir.

Öne çıkanlar:

- **Buz tuzakları:** 3B haritada NASA’nın kalıcı gölge haritası; her iniş noktasının en yakın büyük buz tuzağına uzaklığı skora girer.
- **Gerçek arazi:** 82°G’nin güneyindeki her nokta için LOLA verisinden ufuk çizgisi ve eğim.
- **En iyi noktayı bul:** kutup çevresini tarar, dik ve gölgeli yerleri eler, en iyi beş iniş noktasını haritada gösterir.
- **Batarya grafiği:** yük, batarya ve panel girilir; doluluk saat saat çizilir, gereken en küçük batarya hesaplanır.
- **NASA çalışma bölgeleri:** NASA Veri Kitabı’ndaki 14 bölgenin her birinde en iyi iniş noktasını bulur; Ekim 2024 Artemis III adayları işaretlidir.
- **Buza gezici rotası**, **sıcaklık haritası** ve **iletişim haritası** (3B Harita sekmesi).
- **Tüm Ay katmanları:** tüm yüzey için kaba eğim haritası, iki kutupta kabartma ve kalıcı gölge, “Tüm Ay” taraması.
- **Hazır senaryolar** ve iki sayfalık **görev raporu (PDF)**.
- **Gezinme rehberi:** üst bardaki `?` tuşu siteyi 15 adımda gezdirir.

## Nasıl açılır

Zip dosyasını bir klasöre çıkarın. Sonra aşağıdakilerden biri yeterli:

| Yol | Ne yapılır | Ne gerekir |
|---|---|---|
| **En kolay** | `index.html` dosyasına çift tıklayın | Yalnızca bir tarayıcı (Chrome, Edge, Firefox, Safari) |
| **Windows** | `AstroApex-Baslat.bat` dosyasına çift tıklayın | Python varsa sunucuyu başlatır, yoksa siteyi doğrudan açar |
| **macOS / Linux** | Terminalde `sh astroapex-baslat.sh` | Python 3 varsa sunucuyu başlatır, yoksa siteyi doğrudan açar |
| **Elle** | `python server.py --open` | Python 3.8+ |

Kurulum, derleme veya ek paket gerekmez. Tüm hesaplar tarayıcıda yapılır.

### E-postayla göndermek

Gmail gibi servisler içinde `.js` veya `.bat` dosyası bulunan ekleri (zip içinde olsa bile) engeller.
Bu yüzden e-postayla **tek dosyalık sürümü** gönderin: `dist/AstroApex.html`. Alan kişi dosyayı indirip
çift tıklar; başka hiçbir şey gerekmez. Dosyayı yeniden üretmek için: `python tools/build_single.py`.
Projenin tamamını (zip) paylaşmak için Google Drive gibi bir bağlantı kullanın.

Ay görüntüsü, efemeris tablosu ve LOLA arazi verisi sitenin içindedir. İnternet yalnızca yazı tipleri ve
(isteğe bağlı) yapay zekâ modeli için kullanılır; internet yoksa site yine tam çalışır.

## Kısayollar

| Tuş | İşlev |
|---|---|
| `1` – `5` | Sekmeler: Karşılaştır, Gökyüzü, Zaman, 3B Harita, Kaynaklar |
| `Boşluk` | Zamanı oynat / duraklat |
| `←` `→` | Zamanı 1 saat ilerlet / geri al (`Shift` ile 1 gün) |
| `/` veya `Ctrl+K` | Asistanı aç |
| `Enter` | Asistana soruyu gönder (`Shift+Enter` yeni satır) |
| `Esc` | Asistanı, rehberi veya raporu kapat |

## Veri kaynakları

| Konu | Kaynak |
|---|---|
| Güneş ve Dünya konumu | **NASA NAIF SPICE** (CSPICE N0067), **JPL DE440** efemerisi, `IAU_MOON` çerçevesi, `LT+S` düzeltmesi. 2024–2040 arası 2 saatlik tablo: `data/spice_table.js` |
| Bağımsız çapraz kontrol | astronomy-engine (VSOP87 / ELP). “Kaynaklar” sekmesindeki doğrulama paneli iki yöntemi canlı karşılaştırır; fark tipik olarak 0,005°’nin altındadır |
| Arazi ufku | LOLA 80 m DEM (Barker ve ark. 2023) — Shackleton Rim, Connecting Ridge, Malapert Massif merkezleri için hazır profil. 82°G’nin güneyindeki diğer noktalarda profil, 480 m’lik LOLA ızgarasından tarayıcıda hesaplanır. Bu alanın dışında sabit ufuk açısı |
| Eğim | NASA LOLA `LDEM_75S_240M` yükseklik modelinden, 480 m taban uzunluğuyla türetilir (NASA PDS) |
| Kalıcı gölge (buz tuzakları) | NASA Goddard PGDA `LPSR_75S_120M_201608` (Mazarico ve ark. 2011). En az 3 km² bağlantılı gölge “büyük tuzak” sayılır |
| Çalışma bölgesi merkezleri | NASA Moon to Mars Lunar Surface Data Book, M2M-30044 (Mart 2025), Tablo A2.1-1. Bölge merkezleri iniş noktası değil, referans noktasıdır |
| Harita | LRO WAC mozaiği, NASA Moon Trek |

SPICE tablosunu yeniden üretmek için (isteğe bağlı): NASA kernel dosyalarını `kernels/` klasörüne
koyun (adresler `tools/build_spice_table.py` dosyasının başında), ardından:

```
pip install spiceypy
python tools/build_spice_table.py
```

Arazi paketini (`data/polar_data.js`) yeniden üretmek için (isteğe bağlı): `tools/build_polar_data.py`
dosyasının başındaki iki NASA dosyasını bir klasöre indirin, ardından:

```
pip install numpy pillow
python tools/build_polar_data.py <klasör>
```

## Asistan

Asistan varsayılan olarak **yerel analiz motoruyla** çalışır; internet veya anahtar gerektirmez.
Soruya göre yeni hesap yapar. Örnekler:

- “A için en iyi tarih ne?” — önümüzdeki 365 günü tarar
- “En iyi saha hangisi?” — tüm sahaları sıralar
- “En iyi noktayı bul” — kutup çevresini gerçek LOLA arazisiyle tarar
- “Buza ne kadar yakın?”, “Eğim nasıl?”, “Batarya yeter mi?”, “Görev raporu”
- “Artemis bölgelerini puanla”, “Buza nasıl gideriz?”, “Sıcaklık haritası”
- “Malapert’i 15 Mart 2027’de 30 gün için değerlendir”
- “Riskler ve öneriler”, “500 W için batarya”, “2500 kg ve Isp 310 için yakıt”
- “İletişim pencerelerini listele”, “SPICE nedir?”, “veriler ne kadar doğru?”

### Yapay zekâ modeli bağlamak (isteğe bağlı)

Site `server.py` ile açıldığında asistan bir Claude modeline bağlanabilir. Model, yerel motorun
hesapladığı sayıları ve canlı görev verisini alır; sayıları kendisi uydurmaz.

1. `pip install anthropic`
2. Anthropic API anahtarınızı `ANTHROPIC_API_KEY` ortam değişkenine yazın **veya** yalnızca anahtarı
   içeren `api_key.txt` adlı bir dosyayı `server.py` ile aynı klasöre koyun.
3. `python server.py --open`

Asistan başlığında “Yapay zekâ bağlı” yazar. Anahtar yoksa veya bağlantı kurulamazsa yerel motor
yanıt vermeye devam eder.

> `api_key.txt` dosyasını kimseyle paylaşmayın ve e-postayla gönderdiğiniz zip’e eklemeyin.

## Dosyalar

| Dosya | Görev |
|---|---|
| `index.html`, `styles.css` | Sayfa ve görünüm |
| `js/ephem.js` | Efemeris: SPICE tablosu + astronomy-engine yedeği |
| `js/app.js` | Simülasyon, güç modeli, grafikler, 3B harita |
| `js/polar.js`, `data/polar_data.js` | Güney kutbu arazi motoru ve verisi: ufuk, eğim, kalıcı gölge |
| `js/scout.js` | “En iyi noktayı bul” taraması ve NASA bölgelerinin puanlanması |
| `js/report.js` | Görev raporu ve PDF |
| `js/fx.js` | Açılış, arka plan ve gezinme rehberi |
| `js/assistant.js` | Analiz motoru ve sohbet paneli |
| `js/i18n.js` | Türkçe / İngilizce metinler, saha listesi |
| `js/terrain.js` | LOLA ufuk profilleri |
| `data/spice_table.js` | NASA SPICE (DE440) efemeris tablosu |
| `data/moon_texture.js` | 3B harita ve arka plan için Ay görüntüsü (LRO WAC) |
| `server.py` | Yerel sunucu (isteğe bağlı) |
| `tools/build_spice_table.py` | SPICE tablosunu üreten betik |
| `tools/build_polar_data.py` | Arazi paketini üreten betik |
| `tools/build_moon_texture.py` | Ay görüntüsünü üreten betik |
| `tools/build_single.py` | Tek dosyalık `dist/AstroApex.html` ve web sürümünü üreten betik |

## Sınırlar

Skor, yakıt, batarya ve sıcaklık değerleri ön tasarım göstergeleridir; sertifikalı güvenlik analizi
değildir. LOLA arazi ufku olmayan sahalarda sonuçlar iyimser olabilir. Eğim 480 m ölçeğindedir; kaya ve
küçük krater gibi tehlikeleri göstermez. Kalıcı gölge, buzun kanıtı değil, buzun kalabileceği soğuk bölgedir. Kesin görev tasarımı için
sonuçları JPL Horizons ve QuickMap aydınlatma katmanlarıyla doğrulayın.
