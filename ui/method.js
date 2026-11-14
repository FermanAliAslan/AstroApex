// Keep the short reading guide next to the datasets used by the browser planner.
(() => {
  const method = document.getElementById("method");
  if (!method) return;

  function sourceLink(parent, text, href, download = false) {
    const link = document.createElement("a");
    link.className = "r-link";
    link.href = href;
    link.textContent = text;
    if (download) link.download = "";
    else {
      link.target = "_blank";
      link.rel = "noopener noreferrer";
    }
    parent.append(link);
  }

  const horizons = method.querySelector('a[href="assets/horizons-samples.json"]').closest("article");
  horizons.querySelector("p").textContent =
    "1 Ocak 2026–31 Aralık 2027 için Güneş ve Dünya’nın konumları 17.520 saatlik kayıttan hesaplanır. " +
    "Üç hazır sahada 18–31 Ekim 2026 için doğrudan Horizons gözlemci tabloları kullanılır. " +
    "Diğer tarihlerde ve özel koordinatlarda konumlar seçilen noktanın yerel gökyüzüne dönüştürülür.";
  const sampleLink = horizons.querySelector("a[download]");
  sampleLink.textContent = "Üç sahanın Ekim tabloları (JSON) ↓";
  sourceLink(horizons.querySelector(".r-links"), "2026–2027 konum verisi (JSON) ↓", "assets/lunar-vectors.json", true);
  sourceLink(horizons.querySelector(".r-links"), "Sorgular ve doğrulama ↗", "assets/lunar-vectors-provenance.txt");

  const atlas = method.querySelector('a[href="#atlas"]').closest("article");
  atlas.querySelector("p").textContent =
    "Gri kutup haritası yüzeyi gösterir. Aydınlanma katmanı 2010–2011 LROC gözlemlerini, Dünya görüşü katmanı ise 18,6 yıllık bir dönemi özetler. " +
    "Seçtiğiniz görev tarihindeki koşulları zaman çizelgesinden okuyabilirsiniz.";
  sourceLink(atlas.querySelector(".r-links"), "Katmanların kaynakları ↗", "assets/resources-map-provenance.txt");

  const guide = method.querySelectorAll(".s-method li");
  guide[0].querySelector("p").textContent =
    "Saati UTC olarak seçin. Azimut kuzeyden doğuya doğru ölçülür. Yükseklik açısı, gök cisminin merkezinin seçilen konumdaki yatay düzleme göre açısıdır. " +
    "Her saat başındaki durum bir sonraki saate kadar geçerli kabul edilir. Demo modunda örnek hareketler kullanılır.";
  guide[1].querySelector("h3").textContent = "Yöne göre yerel ufuk";
  guide[1].querySelector("p").textContent =
    "Üç hazır sahada LOLA modeli, gözlemciyi yüzeyden 2 m yukarı yerleştirir. 80 m aralıklı yükseklik verisinden her 0,5° yönde, 180 km’ye kadar görünen en yüksek arazi açısını bulur. " +
    "Güneş ve Dünya kendi yönlerindeki ufukla karşılaştırılır. Küçük kayalar ve araç engelleri bu ölçekte görünmez. Özel konumlarda ve demoda sabit açı tüm yönlere uygulanır.";
  sourceLink(guide[1], "LOLA verisi ve ufuk hesabı ↗", "assets/terrain-horizon-source.txt");
  guide[2].querySelector("p").textContent =
    "Güneş ve Dünya aynı saat başında ufkun üzerindeyse bu saat ortak süreye eklenir. Ardışık saatler bir pencere oluşturur. " +
    "Doğuş ve batış iki örnek arasında gerçekleşebilir. Dünya görüşü doğrudan iletişim için geometrik bir fırsattır. Gerçek bağlantı antene ve yer istasyonuna da bağlıdır.";
  guide[3].querySelector("p").textContent =
    "Görev içindeki en uzun karanlık, Güneş’in ufku aşmadığı en uzun kesintisiz saat dizisidir. " +
    "Enerji tahmini için aydınlık saatleri seçili panel gücü ve örnek 0,72 sistem katsayısıyla çarpılır. Panel yönelimi ve batarya doluluğu ayrıca modellenmez.";
})();
