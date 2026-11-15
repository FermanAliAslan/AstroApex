# AstroApex

**Ay’a nerede ve ne zaman inmeliyiz?**

AstroApex, Ay’daki iniş sahalarını ve görev tarihlerini güneş ışığı, yerel arazi ufku ve Dünya’yla doğrudan görüş açısından karşılaştıran bir web uygulamasıdır. NASA Space Apps 2026’nın **Lunar Landing Site Navigator / CLPS Lunar Mission Browser** problemi için geliştirilmiştir.

[Canlı uygulama](https://fermanaliaslan.github.io/AstroApex/) · [İngilizce sunum PDF’si](doc/AstroApex-Lunar-Navigator-English.pdf) · [İngilizce Navigator rehberi](navigator/README.md) · [Yarışma problemi](https://www.spaceappschallenge.org/2026/challenges/lunar-landing-site-navigator/)

## Neyi çözüyor?

Ay’ın güney kutbunda Güneş ufka yakın hareket eder. Bir krater kenarı veya sırt, güneş panellerini gölgede bırakabilir ve Dünya görüşünü kesebilir. İniş tarihi değiştiğinde aynı sahanın enerji ve iletişim koşulları da değişebilir.

AstroApex iki planı aynı ekranda karşılaştırır. Kullanıcı toplam güneşlenme süresinin yanında kesintisiz karanlığın, iletişim kaybının ve eşzamanlı Güneş–Dünya görüşünün ne kadar sürdüğünü inceleyebilir. Amaç, görev ekiplerinin alternatifleri hızlı değerlendirmesini ve öğrencilerin bu kararların nedenlerini anlamasını sağlamaktır.

## Uygulamada neler var?

| Alan | Yapabilecekleriniz |
|---|---|
| **Saha ve tarih karşılaştırması** | 27 hazır sahadan seçin veya özel koordinat girin. Aynı sahayı farklı tarihlerde, farklı sahaları aynı tarihte karşılaştırın. |
| **Gökyüzü ve zaman çizelgesi** | Güneş ve Dünya’nın yerel ufka göre konumunu, görünürlük pencerelerini ve bir sonraki doğuş veya batışa kalan süreyi izleyin. |
| **Güç ve batarya** | Panel alanı, güç tüketimi ve batarya kapasitesini değiştirerek karanlık dönemlerinin etkisini değerlendirin. |
| **3B Ay haritası** | Rölyef, eğim, kalıcı gölge, tahmini sıcaklık ve Dünya görünürlüğü katmanlarını inceleyin. |
| **Saha taraması ve gezgin rotası** | NASA çalışma bölgelerindeki aday noktaları değerlendirin ve kalıcı gölge alanlarına erişimi araştırın. |
| **Asistan ve paylaşım** | Tarih veya saha alternatiflerini yeniden hesaplatın. İki sayfalık görev raporu, CSV ve senaryo bağlantısı oluşturun. |

Arayüz Türkçe ve İngilizce kullanılabilir. Saha seçicilerinde arama ve koordinat bilgisi, açılır menülerde klavye desteği, görev zaman çizelgesinde sürüklenebilir bir işaretçi bulunur.

## Hızlı başlangıç

### Tarayıcıdan

[Canlı uygulamayı açın](https://fermanaliaslan.github.io/AstroApex/). Sağ üstteki **TR / EN** düğmeleriyle dili değiştirebilirsiniz.

Örnek karşılaştırma için iki senaryoda da **Malapert Massif**, görev süresinde **14 gün** seçin. A’yı **8 Ocak 2027 00.00 UTC**, B’yi **15 Ocak 2027 00.00 UTC** tarihinde başlatın. Toplam ortak görüş ile en uzun iletişim kesintisini birlikte inceleyin.

### Bilgisayarınızda

Aşağıdaki komutları Git ve Python 3 yüklü bir bilgisayarda çalıştırın.

```sh
git clone https://github.com/FermanAliAslan/AstroApex.git
cd AstroApex
python3 navigator/server.py --open
```

Komut, yerel sunucuyu başlatıp tarayıcıyı açar. Kullanılan adres terminalde gösterilir.

### Çevrimdışı tek dosya

[navigator/dist/AstroApex.html](navigator/dist/AstroApex.html) dosyasını indirip tarayıcıda açın. Görev hesabı için gereken veri ve kod bu dosyaya gömülüdür. Haricî yazı tipleri yüklenemezse sistem yazı tipleri kullanılır.

## Nasıl çalışıyor?

1. **Veri hazırlama** — Python betikleri NASA kaynaklarından konum tablolarını, arazi ızgaralarını ve görüntüleri hazırlar.
2. **Tarayıcı hesabı** — JavaScript, seçilen koordinat ve tarih için Güneş–Dünya geometrisini yerel ufukla birleştirir. Görüş pencereleri ve güç modeli bu hesapları kullanır.
3. **Görselleştirme** — HTML, CSS ve Canvas, sonuçları senaryo karşılaştırması, gökyüzü, zaman çizelgesi ve Ay haritasında gösterir.
4. **Raporlama** — Yerel analitik asistan alternatif senaryoları değerlendirir. PDF ve CSV çıktıları tarayıcıda hazırlanır.

Depodaki **C/Lua/SPICE motoru** ayrıca çalıştırılabilen bir hesap bileşenidir. Yayımlanan Navigator, hesaplarını tarayıcıda kendi paketlenmiş verileriyle yürütür.

## Veriler ve kaynaklar

| Veri | Kullanım |
|---|---|
| **NASA NAIF SPICE / JPL DE440** | Güneş ve Dünya konumları. `IAU_MOON` çerçevesinde `LT+S` düzeltmeleriyle hazırlanmış iki saatlik 2024–2040 tablosu. |
| **LRO / LOLA** | Yerel ufuk, yükselti ve eğim. Üç referans merkezinde 80 m kaynaklı ufuk profilleri; diğer kapsanan güney kutbu noktalarında 480 m ızgara. |
| **NASA Goddard kalıcı gölge verisi** | Gölge alanlarının gösterimi ve olası soğuk tuzaklarına erişimin değerlendirilmesi. |
| **NASA Lunar Surface Data Book** | Çalışma bölgelerinin referans konumları. |
| **LRO WAC / NASA Moon Trek** | Ay yüzeyi görüntüleri. |
| **astronomy-engine** | Bağımsız konum karşılaştırması ve SPICE tablosunun kapsamı dışındaki tarihler için hesap. |

Veri seti adları ve üretim adımları için [Navigator kaynak açıklamalarına](navigator/README.md#nasa-data-and-sources) ve [veri hazırlama betiklerine](navigator/tools/) bakın.

## Sonuçları nasıl yorumlamalı?

- **Dünya görüşü geometrik bir iletişim fırsatıdır.** Anten özellikleri, radyo bağlantı bütçesi ve yer istasyonlarının uygunluğu ayrıca değerlendirilmelidir.
- **Arazi çözünürlüğü sonucu etkiler.** 480 m ızgara dar sırtları, küçük kraterleri ve kayaları kaçırabilir. Bu konumlardaki güneşlenme ve tarama sonuçları iyimser olabilir.
- **Kalıcı gölge buzun korunabileceği koşulları gösterir.** Buzun gerçekten bulunup bulunmadığı ayrı ölçümler gerektirir.
- **Puan, batarya, sıcaklık ve yakıt hesapları ön değerlendirme içindir.** Altı bileşenli puana ek olarak öneriler seçilen bataryanın tükenmesini, görev boyunca hiç Dünya görüşü olmamasını ve bilinen ortalama eğimin 15° üzerinde olmasını denetler. Her iki seçenek de bu koşulları karşılamıyorsa gerekçeler gösterilir. Göreve özgü azami iletişim kesintisi, yerel iniş tehlikeleri ve radyo bütçesi ayrıca değerlendirilmelidir.
- **Zaman çözünürlükleri farklıdır.** Ayrıntılı görev hesabı, asistan önizlemesi ve aday puanlaması aynı görev süresi için aynı adımı kullanır. Yıllık görünüm iki saatlik adımlarla tarar. Her iki hesap arazi ufkunu ve tutulmayı değerlendirir; kısa olayların zamanlaması örnekleme aralığıyla sınırlıdır.
- **Tarama sonuçları örneklenen adayları karşılaştırır.** NASA bölge merkezleri çevresinde yaklaşık eş alanlı daireler kullanılır. Rota mesafesi çizilen yol boyunca hesaplanır. 15° ile yol bulunamazsa daha yüksek eğimle bulunan seçenek açıkça işaretlenir.

## Klasör yapısı

| Yol | İçerik |
|---|---|
| [`navigator/`](navigator/) | Canlı uygulamanın kaynakları |
| [`navigator/js/`](navigator/js/) | Görev hesabı, harita, saha taraması, asistan, rapor ve arayüz modülleri |
| [`navigator/data/`](navigator/data/) | Paketlenmiş konum, arazi ve görüntü verileri |
| [`navigator/tools/`](navigator/tools/) | Veri üretimi ve tek HTML dosyasına paketleme |
| [`navigator/dist/`](navigator/dist/) | Çevrimdışı dağıtım |
| [`src/`](src/) ve [`lua/`](lua/) | Bağımsız yerel hesap motoru |
| [`data/`](data/) | Yerel motorun SPICE çekirdekleri ve örnek JSON verileri |
| [`tests/`](tests/) | Yerel motorun regresyon testleri |
| [`ui/`](ui/) | Horizons verileri, atlas ve yüzey mesafe aracı içeren ek görev konsolu |
| [`doc/`](doc/) | Sunum ve proje belgeleri |

## Geliştirme ve dağıtım

Navigator kaynaklarında değişiklik yaptıktan sonra, tek dosyalık sürüm aşağıdaki komutla yeniden oluşturulur.

```sh
python3 navigator/tools/build_single.py
```

Bu komut `navigator/dist/AstroApex.html` ve gömülü sayfa kullanımları için `navigator/dist/astroapex-web.html` üretir. Canlı site, **gh-pages** dalındaki `index.html` üzerinden yayımlanır. Kaynaklar **main** dalındadır; canlı sürümde yayımlanacak dosya, yeniden oluşturulan `AstroApex.html` paketidir.

### İsteğe bağlı yerel sohbet servisi

`navigator/server.py`, sayfayı yerelde sunabilir ve Anthropic bağlantısı yapılandırıldığında çevrimiçi sohbet ekler. Başlatmak için aşağıdaki komutu çalıştırın.

```sh
python3 navigator/server.py --open
```

Sunucu 5173 portundan başlayarak uygun bir yerel port seçer. Çevrimiçi sohbet için `anthropic` paketi ve `ANTHROPIC_API_KEY` ortam değişkeni kullanılır. Bu modda terminalde gösterilen kişisel oturum bağlantısı tarayıcıyı yetkilendirir; `--open` bunu otomatik açar. Oturum bağlantısını özel tutun.

Eski bir kurulumda `navigator/api_key.txt` oluşturduysanız anahtarı ortam değişkenine taşıyıp bu dosyayı yayımlanan klasörden kaldırın. Başlatma ve oturum davranışının ayrıntıları [sunucu dosyasında](navigator/server.py) bulunur.

### Tarayıcı regresyon testleri

Node.js 22+, Python 3 ve Chromium ile görev hesabı, asistan, rota, dışa aktarma ve arayüz kontrollerini çalıştırabilirsiniz.

```sh
npm ci
npx playwright install chromium
python3 -m pip install pypdf==6.21.4
npm run build
npm test
python3 -m unittest discover -s tests -p test_navigator_server.py
```

[Navigator iş akışı](.github/workflows/navigator.yml) bu testleri ve kaynaklarla tek dosyalık paket eşleşmesini denetler. AI servisinin testleri gerçek sağlayıcı çağrıları yerine yerel test yanıtları kullanır.

### C/Lua motoru ve testler

Gerekenler C derleyicisi, Make, Python 3, Lua 5.4 geliştirme dosyaları, pkg-config ve platformunuza uygun [NAIF CSPICE araç takımıdır](https://naif.jpl.nasa.gov/naif/toolkit_C.html). Araç takımını `cspice/include/SpiceUsr.h` ve `cspice/lib/cspice.a` yolları oluşacak şekilde depo köküne çıkarın.

```sh
make test
make once
```

`make test` yerel motorun regresyon testlerini çalıştırır. `make once`, `data/input.json` girdisini işleyerek `data/output.json` çıktısını üretir. HTTP modu 127.0.0.1 üzerinde çalışır; istek okuma ve yanıt yazma için ayrı beş saniyelik süre sınırları vardır. Lua 5.4 yorumlayıcısıyla `lua5.4 tests/test_json_retention.lua` bellek kontrolünü de çalıştırabilirsiniz. GitHub Actions aynı motoru Linux üzerinde derleyip test eder. [CI yapılandırması](.github/workflows/backend.yml)

## Geliştirme araçları

Kodun geliştirilmesi ve incelenmesi sürecinde **Claude ve Codex** kullanıldı. Bilimsel girdilerin kaynakları yukarıdaki tabloda ve veri üretim betiklerinde belirtilmiştir. Uygulamanın hesapladığı puanlar ve mühendislik tahminleri, bu girdilerle birlikte kullanılan model varsayımlarına bağlıdır.
