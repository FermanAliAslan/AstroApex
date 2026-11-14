(() => {
  const id = key => document.getElementById(key);
  const make = (tag, text) => Object.assign(document.createElement(tag), {textContent:text});
  const percent = n => "%" + n.toLocaleString("tr-TR", {maximumFractionDigits:2});
  const localJSON = async name => {
    const response = await fetch("assets/"+name);
    if (!response.ok) throw new Error("Kaynak yüklenemedi.");
    return response.json();
  };
  function external(url, label) {
    const a=make("a",label+" ↗");a.href=url;a.target="_blank";a.rel="noopener noreferrer";a.className="r-link";return a;
  }
  let maps, pendingMaps, pendingCatalog, site;
  function showMap() {
    if(!maps)return;
    const kind=id("rLayer").value, trek=kind==="trek";
    const k=trek?"sun":kind, layer=maps.layers[k], current=maps.sites[site];
    const preview=trek?maps.trekBrowse:layer;
    const img=id("rMap");
    img.src=preview.image;img.alt=preview.name+" · Ay güney kutbu, 100 × 100 km.";
    id("rMapName").textContent=preview.name;
    id("rMapNote").textContent=preview.definition+" "+layer.period+".";
    id("rMapScale").textContent=trek?"Özgün gri tonlama · nicel renk ölçeği uygulanmaz.":"Ölçek: %0 (koyu) – %100 (açık). Koyu gri alanlarda veri yok.";
    const legend=document.querySelector(".r-legend");legend.hidden=trek;
    if(!trek)legend.style.background="linear-gradient(90deg,"+layer.colors.join(",")+")";
    id("rMapCaption").textContent="100 × 100 km · "+maps.projection+" · "+(trek?"Moon Trek WMTS":layer.sampleMeters+" m kaynak pikseli");
    id("rProduct").href=trek?maps.trekBrowse.wmts:layer.metadata;
    id("rProduct").textContent=trek?"WMTS katman bilgisi ↗":"Ürün ve yöntem ↗";
    const nodes=[];
    for(const [name,loc] of Object.entries(maps.sites)){
      if(loc.x==null)continue;
      const pin=make("span",name===site?"◆":"◇");pin.className="r-map-pin";pin.setAttribute("aria-hidden","true");pin.style.left=loc.x+"%";pin.style.top=loc.y+"%";pin.title=name;nodes.push(pin);
    }
    id("rPins").replaceChildren(...nodes);
    const area=current?.x==null&&current?" · Harita kesitinin dışında.":"";
    id("rMapValue").textContent=!current?"Bu örnek saha için arşiv pikseli yok.":site+" · "+(current[k]==null?"Bu üründe saha değeri yok.":percent(current[k])+" — bölge merkezine en yakın kaynak pikseli.")+area;
  }
  function catalog(items) {
    const root=id("eoRecords");
    root.replaceChildren(...items.map(item=>{
      const card=document.createElement("article");
      card.append(make("small",item.domain),make("h3",item.title),make("p",item.description));
      if(item.image){const figure=document.createElement("figure"),img=new Image();img.loading="lazy";img.src=item.image;img.alt=item.imageAlt||item.title;figure.append(img,make("figcaption",item.credit));card.append(figure);}
      const dl=document.createElement("dl");
      for(const f of item.facts){const pair=document.createElement("div");pair.append(make("dt",f.label),make("dd",f.value));dl.append(pair);}
      card.append(dl,external(item.sourceUrl,"Kaynak"),external(item.recordUrl,item.recordLabel));
      if(item.licenseUrl)card.append(external(item.licenseUrl,"Lisans"));
      return card;
    }));
  }
  id("rLayer").addEventListener("change",showMap);
  function sync({route,plan}){
    const changed=site!==plan.site;site=plan.site;
    if(route==="atlas"){
      if(maps){if(changed||!id("rMap").hasAttribute("src"))showMap();}
      else if(!pendingMaps)pendingMaps=localJSON("resources-maps.json").then(j=>{maps=j;showMap()}).catch(()=>{pendingMaps=null;id("rMapNote").textContent="Harita verisi yüklenemedi. Kaynak haritayı açabilirsiniz.";});
    }else if(changed && maps) showMap();
    if(route==="method"&&!pendingCatalog)pendingCatalog=localJSON("eo-catalog.json").then(j=>catalog(j.items)).catch(()=>{pendingCatalog=null;id("eoRecords").textContent="Veri kataloğu yüklenemedi. Sayfayı yenileyin.";});
  }
  window.addEventListener("mission:update",e=>{if(e.detail.source==="route"||e.detail.source==="plan")sync(e.detail);});
})();
