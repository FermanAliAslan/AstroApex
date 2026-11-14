/* On-demand WebGL2 renderer for LROC imagery and true-scale LOLA lunar topography.
   Lunar coordinates use east-positive longitude and an orthographic camera. */
(() => {
  "use strict";
  const canvas = document.getElementById("moonGlobe");
  if (!canvas) return;
  const stage = canvas.closest(".globe-stage") || canvas.parentElement;
  const status = document.getElementById("globeStatus");
  const controls = [...document.querySelectorAll("[data-globe]")];
  const pin = document.getElementById("globePin") || makePin();
  const pinLabel = pin.querySelector("[data-globe-pin-label]");
  const initial = { lat: -34, lon: 8, zoom: 1 };
  const camera = { ...initial };
  const radians = Math.PI / 180;
  const points = new Map();
  const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)");
  let flight = null;
  let markers = [];
  let lighting = "relief";
  let projection = null;
  let press = null;
  let exploring = false;
  const minZoom = 0.72;
  const maxZoom = 8;
  let site = null;
  let missionSite = null;
  let active = false;
  let state = "idle";
  let scene = null;
  let context = null;
  let nextFrame = 0;
  let generation = 0;

  function makePin() {
    const marker = document.createElement("span");
    marker.id = "globePin";
    marker.className = "globe-pin";
    marker.innerHTML = "<i></i><span data-globe-pin-label></span>";
    marker.setAttribute("aria-hidden", "true");
    canvas.insertAdjacentElement("afterend", marker);
    return marker;
  }
  pin.hidden = true;
  function knownSite(point = site) {
    return (
      point &&
      Number.isFinite(point.lat) &&
      Number.isFinite(point.lon) &&
      Math.abs(point.lat) <= 90
    );
  }
  function updateButtons() {
    for (const control of controls) {
      const action = control.dataset.globe;
      control.disabled =
        state !== "ready" ||
        (action === "focus" && !knownSite(missionSite)) ||
        (action === "zoom-in" && (flight?.to.zoom ?? camera.zoom) === maxZoom) ||
        (action === "zoom-out" && (flight?.to.zoom ?? camera.zoom) === minZoom);
    }
  }
  function setState(value, message = "") {
    state = value;
    stage.dataset.globeState = value;
    canvas.hidden = value === "unavailable";
    canvas.setAttribute("aria-busy", String(value === "loading"));
    if (status) {
      status.textContent = message;
      status.hidden = !message;
    }
    if (value !== "ready") pin.hidden = true;
    updateButtons();
  }
  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }
  function surface(lat, lon) {
    const a = lat * radians;
    const b = lon * radians;
    return [Math.cos(a) * Math.sin(b), Math.sin(a), Math.cos(a) * Math.cos(b)];
  }
  function dot(a, b) {
    return a.reduce((sum, value, i) => sum + value * b[i], 0);
  }

  // Map north is at v=0 and the prime meridian is at u=.5.
  // Coordinates of mesh vertices, texture samples and atlas markers share this frame.
  const columns = 512, rows = 256;
  const vertexSource = `#version 300 es
    precision highp float;
    in vec2 aUV;
    in float aElevation;
    uniform mat3 uView;
    uniform vec2 uScale;
    out vec2 vUV;
    void main() {
      float lon = (aUV.x - .5) * 6.28318530718;
      float lat = (.5 - aUV.y) * 3.14159265359;
      vec3 normal = vec3(cos(lat)*sin(lon), sin(lat), cos(lat)*cos(lon));
      float km = (aElevation - 20000.) * .0005;
      vec3 pos = uView * normal * (1. + km / 1737.4);
      gl_Position = vec4(pos.xy*uScale, -pos.z*.8, 1.);
      vUV = aUV;
    }`;
  const fragmentSource = `#version 300 es
    precision highp float;
    precision highp sampler2DArray;
    in vec2 vUV;
    uniform mat3 uView;
    uniform sampler2D uColor, uNormal;
    uniform sampler2DArray uTileColor, uTileNormal;
    uniform ivec4 uTileIds;
    uniform bool uAtlasLight;
    out vec4 fragColor;
    void main() {
      vec3 albedo = texture(uColor,vUV).rgb;
      vec3 normal = texture(uNormal,vUV).rgb;
      vec2 regional = vec2(fract(vUV.x),clamp(vUV.y,0.,.9999999))*vec2(8.,4.);
      ivec2 cell = ivec2(regional);
      int slot = (cell.x%2) + 2*(cell.y%2);
      if (uTileIds[slot] == cell.y*8 + cell.x) {
        vec2 within = fract(regional);
        // The source tiles include a two-pixel border sampled from their neighbours.
        vec3 c = texture(uTileColor,vec3((within*1024.+2.)/1028.,float(slot))).rgb;
        vec3 n = texture(uTileNormal,vec3((within*720.+2.)/724.,float(slot))).rgb;
        float footprint = max(fwidth(vUV.x)*8192.,fwidth(vUV.y)*4096.);
        float weight = 1. - smoothstep(1.5,4.,footprint);
        albedo = mix(albedo,c,weight);
        normal = mix(normal,n,weight);
      }
      vec3 local = normal*2.-1.;
      float lon = (vUV.x-.5)*6.28318530718, lat = (.5-vUV.y)*3.14159265359;
      vec3 east = vec3(cos(lon),0.,-sin(lon));
      vec3 up = vec3(cos(lat)*sin(lon),sin(lat),cos(lat)*cos(lon));
      vec3 north = cross(up,east);
      // Fixed raking light and mildly strengthened slopes make low rims legible.
      vec3 n = normalize(uView * (mat3(east,north,up)*vec3(local.xy*1.75,local.z)));
      float diffuse = max(dot(n,normalize(vec3(-.82,.45,.64))),0.);
      float brightness = uAtlasLight ? .96 : pow(.20+1.09*diffuse,1./2.2);
      fragColor = vec4(albedo*brightness,1.);
    }`;

  const terrainDir = 'assets/lunar-terrain/';
  function loadImage(url) {
    const image = new Image();
    image.src = url;
    return image.decode().then(() => image);
  }

  async function prepare(gl, epoch) {
    const cleanup = [];
    const dispose = () => { while (cleanup.length) cleanup.pop()(); };
    const alive = () => generation === epoch && !gl.isContextLost();
    const highResolution = gl.getParameter(gl.MAX_TEXTURE_SIZE) >= 4096 &&
      !matchMedia('(max-width: 640px)').matches;
    try {
      const [grid, color, normal] = await Promise.all([
        fetch(terrainDir+'shape.u16').then(r => {
          if (!r.ok) throw new Error('Missing lunar elevation grid');
          return r.arrayBuffer();
        }),
        highResolution ? loadImage(terrainDir+'surface-4k.jpg').catch(()=>loadImage('assets/moon-color.jpg'))
          : loadImage('assets/moon-color.jpg'),
        highResolution ? loadImage(terrainDir+'relief-4k.jpg').catch(()=>loadImage(terrainDir+'relief-2k.jpg'))
          : loadImage(terrainDir+'relief-2k.jpg'),
      ]);
      if (!alive()) throw new Error('WebGL context changed');
      const vertexCount = (rows+1)*(columns+1);
      if (grid.byteLength !== vertexCount*2) throw new Error('Invalid lunar elevation grid');
      const program = gl.createProgram();
      cleanup.push(()=>gl.deleteProgram(program));
      for (const [type, source] of [[gl.VERTEX_SHADER,vertexSource],[gl.FRAGMENT_SHADER,fragmentSource]]) {
        const shader=gl.createShader(type);
        gl.shaderSource(shader,source); gl.compileShader(shader);
        gl.attachShader(program,shader); gl.deleteShader(shader);
      }
      gl.linkProgram(program);
      if (!gl.getProgramParameter(program,gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program));
      gl.useProgram(program);
      const uniform = name => gl.getUniformLocation(program,name);
      const vao = gl.createVertexArray();
      cleanup.push(()=>gl.deleteVertexArray(vao)); gl.bindVertexArray(vao);
      function buffer(target,data) {
        const value=gl.createBuffer(); cleanup.push(()=>gl.deleteBuffer(value));
        gl.bindBuffer(target,value); gl.bufferData(target,data,gl.STATIC_DRAW);
      }
      const uv = new Float32Array(vertexCount*2);
      const indices = new Uint32Array(rows*columns*6);
      let offset=0;
      for (let y=0;y<=rows;y++) {
        for (let x=0;x<=columns;x++) {
          const a=y*(columns+1)+x;
          uv[a*2]=x/columns; uv[a*2+1]=y/rows;
          if (x===columns || y===rows) continue;
          const c=a+columns+1;
          indices[offset++]=a; indices[offset++]=c; indices[offset++]=a+1;
          indices[offset++]=a+1; indices[offset++]=c; indices[offset++]=c+1;
        }
      }
      function attribute(name, data, size, type) {
        const id=gl.getAttribLocation(program,name);
        buffer(gl.ARRAY_BUFFER,data); gl.enableVertexAttribArray(id);
        gl.vertexAttribPointer(id,size,type,false,0,0);
      }
      attribute('aUV',uv,2,gl.FLOAT);
      attribute('aElevation',new Uint16Array(grid),1,gl.UNSIGNED_SHORT);
      buffer(gl.ELEMENT_ARRAY_BUFFER,indices);
      gl.bindVertexArray(null);
      const filter = gl.getExtension('EXT_texture_filter_anisotropic');
      gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL,gl.NONE);
      function texture(unit, name, target) {
        const value=gl.createTexture(); cleanup.push(()=>gl.deleteTexture(value));
        gl.activeTexture(gl.TEXTURE0+unit); gl.bindTexture(target,value);
        gl.uniform1i(uniform(name),unit);
        gl.texParameteri(target,gl.TEXTURE_MAG_FILTER,gl.LINEAR);
        gl.texParameteri(target,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);
        return value;
      }
      function baseTexture(unit,name,image) {
        const target=gl.TEXTURE_2D;
        texture(unit,name,target);
        gl.texImage2D(target,0,gl.RGB8,gl.RGB,gl.UNSIGNED_BYTE,image);
        gl.texParameteri(target,gl.TEXTURE_MIN_FILTER,gl.LINEAR_MIPMAP_LINEAR);
        if (filter) gl.texParameterf(target,filter.TEXTURE_MAX_ANISOTROPY_EXT,
          Math.min(4,gl.getParameter(filter.MAX_TEXTURE_MAX_ANISOTROPY_EXT)));
        gl.generateMipmap(target);
      }
      baseTexture(0,'uColor',color);
      baseTexture(1,'uNormal',normal);

      // Four reusable slots cover the nearest 2×2 tiles. The complete base globe
      // remains visible while orbiting and on slow or failed detail requests.
      const ids = new Int32Array(4).fill(-1);
      const desired = new Int32Array(4).fill(-1);
      const requests = new Map();
      const retryTimers = new Map();
      const globeVisible = () => active && !stage.classList.contains("atlas-raster-active");
      function clearRetries() {
        for (const timer of retryTimers.values()) clearTimeout(timer);
        retryTimers.clear();
      }
      cleanup.push(clearRetries);
      let detailTimer;
      cleanup.push(()=>clearTimeout(detailTimer));
      function tileArray(unit,name) {
        const target=gl.TEXTURE_2D_ARRAY;
        const tex=texture(unit,name,target);
        gl.texParameteri(target,gl.TEXTURE_MIN_FILTER,gl.LINEAR);
        gl.texParameteri(target,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);
        // A complete placeholder keeps samplers valid before any close-up.
        gl.texImage3D(target,0,gl.RGB8,1,1,1,0,gl.RGB,gl.UNSIGNED_BYTE,null);
        return {unit,tex};
      }
      const colorTiles=tileArray(2,'uTileColor'), normalTiles=tileArray(3,'uTileNormal');
      let allocated=false;
      function bindTiles(array) {
        gl.activeTexture(gl.TEXTURE0+array.unit); gl.bindTexture(gl.TEXTURE_2D_ARRAY,array.tex);
      }
      function upload(array,slot,img) {
        bindTiles(array);
        gl.texSubImage3D(gl.TEXTURE_2D_ARRAY,0,0,0,slot,img.width,img.height,1,gl.RGB,gl.UNSIGNED_BYTE,img);
      }
      function fetchTile(id, retry = true) {
        const x=id%8, y=Math.floor(id/8), slot=x%2+2*(y%2);
        if (!alive() || !globeVisible() || camera.zoom<2.3 || desired[slot]!==id || ids[slot]===id || requests.has(id)) return;
        const get=kind=>loadImage(terrainDir+kind+x+'-'+y+'.jpg');
        const task=Promise.all([get('c'),get('n')]).then(([c,n])=>{
          if (!alive() || !globeVisible() || camera.zoom<2.3 || desired[slot]!==id) return;
          if (!allocated) {
            for (const [array,size] of [[colorTiles,1028],[normalTiles,724]]) {
              bindTiles(array);
              gl.texImage3D(gl.TEXTURE_2D_ARRAY,0,gl.RGB8,size,size,4,0,gl.RGB,gl.UNSIGNED_BYTE,null);
            }
            allocated=true;
          }
          upload(colorTiles,slot,c); upload(normalTiles,slot,n);
          ids[slot]=id; requestDraw();
        }).catch(()=>{
          if (retry && alive() && globeVisible() && desired[slot]===id && !retryTimers.has(id)) {
            retryTimers.set(id,setTimeout(()=>{
              retryTimers.delete(id);
              fetchTile(id,false);
            },1800));
          }
        }).finally(()=>requests.delete(id));
        requests.set(id,task);
      }
      let requestedRegion='';
      function planDetail() {
        if (!globeVisible() || camera.zoom<2.3) { requestedRegion=''; clearTimeout(detailTimer); return; }
        // Choose four adjacent geographic cells around the current view center.
        const left=Math.floor((wrap(camera.lon)+180)/45-.5);
        const top=clamp(Math.floor((90-camera.lat)/45-.5),0,2);
        const region=left+','+top;
        if (requestedRegion===region) return;
        requestedRegion=region;
        for (let y=top;y<=top+1;y++) for (let dx=0;dx<2;dx++) {
          const x=(left+dx+8)%8;
          desired[x%2+2*(y%2)]=y*8+x;
        }
        clearTimeout(detailTimer);
        detailTimer=setTimeout(()=>{ for(const id of desired) fetchTile(id); },180);
      }
      const view=uniform('uView'), scale=uniform('uScale'), lights=uniform('uAtlasLight'), tiles=uniform('uTileIds');
      gl.enable(gl.DEPTH_TEST); gl.enable(gl.CULL_FACE); gl.clearColor(0,0,0,0);
      return {
        draw(matrix,xScale,yScale) {
          planDetail();
          gl.viewport(0,0,canvas.width,canvas.height);
          gl.clear(gl.COLOR_BUFFER_BIT|gl.DEPTH_BUFFER_BIT);
          gl.useProgram(program); gl.bindVertexArray(vao);
          gl.uniformMatrix3fv(view,false,matrix); gl.uniform2f(scale,xScale,yScale);
          gl.uniform1i(lights,lighting==='atlas'); gl.uniform4iv(tiles,ids);
          gl.drawElements(gl.TRIANGLES,indices.length,gl.UNSIGNED_INT,0);
        },
        pause() {
          clearTimeout(detailTimer);
          requestedRegion = '';
          clearRetries();
        },
        dispose,
      };
    } catch(error) { dispose(); throw error; }
  }

  async function load() {
    if (!active || state !== "idle") return;
    if (location.protocol === "file:") {
      setState(
        "unavailable",
        "3B modeli açmak için planlayıcıyı yerel HTTP adresinden başlatın.",
      );
      return;
    }
    setState("loading", "Ay yüzeyi yükleniyor…");
    const epoch = ++generation;
    try {
      context = canvas.getContext("webgl2", {
        alpha: true,
        antialias: true,
        powerPreference: "low-power",
      });
      if (!context) throw new Error("WebGL2 unavailable");
      const prepared = await prepare(context, epoch);
      if (epoch !== generation) { prepared.dispose(); return; }
      scene = prepared;
      setState("ready");
      requestDraw();
    } catch (error) {
      if (epoch !== generation) return;
      console.warn("AstroApex Moon viewer:", error);
      setState(
        "unavailable",
        "3B görünüm kullanılamıyor. Ay haritası ve saha bilgileri aşağıda.",
      );
    }
  }
  function requestDraw() {
    if (!active || state !== "ready" || document.hidden || nextFrame) return;
    nextFrame = requestAnimationFrame(draw);
  }
  function finishFlight() {
    if (flight) Object.assign(camera, flight.to);
    flight = null;
  }

  function moveCamera(to, duration = 360) {
    // Wrap longitude across the short arc even when crossing the ±180° seam.
    const lonTravel = wrap(to.lon - camera.lon);
    flight = { from: { ...camera }, to, lonTravel, start: performance.now(), duration };
    if (reducedMotion.matches || document.hidden || state !== "ready" ||
        (lonTravel === 0 && camera.lat === to.lat && camera.zoom === to.zoom)) finishFlight();
    updateButtons();
    requestDraw();
  }

  function draw(now) {
    nextFrame = 0;
    if (!active || !scene || document.hidden) return;
    const w = canvas.clientWidth,
      h = canvas.clientHeight;
    if (!w || !h) return;
    if (flight) {
      const t = clamp((now - flight.start) / flight.duration, 0, 1);
      const eased = 1 - (1 - t) ** 3;
      const { from, to, lonTravel } = flight;
      camera.lat = from.lat + (to.lat - from.lat) * eased;
      camera.lon = from.lon + lonTravel * eased;
      camera.zoom = from.zoom + (to.zoom - from.zoom) * eased;
      if (t === 1) finishFlight();
      else requestDraw();
    }
    const ratio = Math.min(
      window.devicePixelRatio || 1,
      1.75,
      2200 / Math.max(w, h),
    );
    const bw = Math.max(1, Math.round(w * ratio)),
      bh = Math.max(1, Math.round(h * ratio));
    if (canvas.width !== bw || canvas.height !== bh) {
      canvas.width = bw;
      canvas.height = bh;
    }
    const lat = camera.lat * radians,
      lon = camera.lon * radians;
    const forward = surface(camera.lat, camera.lon);
    const right = [Math.cos(lon), 0, -Math.sin(lon)];
    const up = [
      -Math.sin(lat) * Math.sin(lon),
      Math.cos(lat),
      -Math.sin(lat) * Math.cos(lon),
    ];
    const view = [
      right[0],
      up[0],
      forward[0],
      right[1],
      up[1],
      forward[1],
      right[2],
      up[2],
      forward[2],
    ];
    const diameter = Math.min(w, h) * 0.86 * camera.zoom;
    projection = { right, up, forward, diameter, w, h };
    scene.draw(view, diameter / w, diameter / h);
    window.dispatchEvent(new CustomEvent("astro:camera", {detail:{...camera, diameter}}));
    drawMarkers();
    if (markers.length || !knownSite()) {
      pin.hidden = true;
      return;
    }
    const location = surface(site.lat, site.lon);
    const x = w / 2 + (diameter / 2) * dot(right, location),
      y = h / 2 - (diameter / 2) * dot(up, location);
    pin.hidden =
      dot(forward, location) < 0.055 ||
      x < 9 ||
      x > w - 9 ||
      y < 9 ||
      y > h - 9;
    pin.style.left = canvas.offsetLeft + x + "px";
    pin.style.top = canvas.offsetTop + y + "px";
    if (pinLabel) pinLabel.textContent = site.name;
  }
  function wrap(lon) {
    return (((lon + 180) % 360 + 360) % 360) - 180;
  }
  function orbit(lon, lat) {
    camera.lon = wrap(camera.lon + lon);
    camera.lat = clamp(camera.lat + lat, -89.99, 89.99);
    requestDraw();
  }
  function zoom(factor) {
    flight = null;
    camera.zoom = clamp(camera.zoom * factor, minZoom, maxZoom);
    updateButtons();
    requestDraw();
  }
  const siteView = () => knownSite() ? { lat: site.lat, lon: site.lon, zoom: 2.6 } : initial;
  function action(name) {
    if (!active || state !== "ready") return;
    // Repeated key presses accumulate from the destination of the current move.
    const to = { ...(flight?.to ?? camera) };
    switch (name) {
      case "left": to.lon = wrap(to.lon - 15); break;
      case "right": to.lon = wrap(to.lon + 15); break;
      case "up": to.lat = clamp(to.lat + 10, -89.99, 89.99); break;
      case "down": to.lat = clamp(to.lat - 10, -89.99, 89.99); break;
      case "zoom-in": to.zoom = Math.min(maxZoom, to.zoom * 1.25); break;
      case "zoom-out": to.zoom = Math.max(minZoom, to.zoom / 1.25); break;
      case "reset": return moveCamera(initial);
      case "focus":
        if (!knownSite(missionSite)) return;
        exploring = false;
        site = missionSite;
        window.dispatchEvent(new CustomEvent("astro:mission-focus", {detail:missionSite}));
        return moveCamera(siteView());
      default: return;
    }
    moveCamera(to, 210);
  }
  for (const control of controls)
    control.addEventListener("click", () => action(control.dataset.globe));
  canvas.style.touchAction = "none";
  canvas.addEventListener("pointerdown", (e) => {
    if (state !== "ready" || (e.pointerType === "mouse" && e.button !== 0))
      return;
    flight = null;
    updateButtons();
    if (!points.size) press = {x:e.clientX, y:e.clientY, moved:false};
    else if (press) press.moved = true;
    points.set(e.pointerId, [e.clientX, e.clientY]);
    canvas.setPointerCapture(e.pointerId);
    stage.dataset.dragging = "true";
  });
  function distance() {
    const [a, b] = points.values();
    return Math.hypot(a[0] - b[0], a[1] - b[1]);
  }
  canvas.addEventListener("pointermove", (e) => {
    const old = points.get(e.pointerId);
    if (!old) return;
    if (press && Math.hypot(e.clientX - press.x, e.clientY - press.y) > 5) press.moved = true;
    const span = points.size === 2 ? distance() : 0;
    points.set(e.pointerId, [e.clientX, e.clientY]);
    if (points.size === 1) {
      const sensitivity =
        145 / (Math.min(canvas.clientWidth, canvas.clientHeight) * camera.zoom);
      orbit(
        (old[0] - e.clientX) * sensitivity,
        (e.clientY - old[1]) * sensitivity,
      );
    } else if (span > 1 && points.size === 2) zoom(distance() / span);
  });
  function cancelPointer(e) {
    if (e.type === "pointerup" && press && !press.moved && points.size === 1) {
      const point = pickSurface(e.clientX, e.clientY);
      if (point) window.dispatchEvent(new CustomEvent("astro:coordinate", {detail:point}));
    }
    press = null;
    points.delete(e.pointerId);
    if (!points.size) delete stage.dataset.dragging;
  }
  for (const name of ["pointerup", "pointercancel", "lostpointercapture"])
    canvas.addEventListener(name, cancelPointer);
  canvas.addEventListener(
    "wheel",
    (e) => {
      if (state !== "ready" || document.activeElement !== canvas) return;
      e.preventDefault();
      const delta =
        e.deltaY *
        (e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? canvas.clientHeight : 1);
      zoom(Math.exp(-clamp(delta, -180, 180) * 0.002));
    },
    { passive: false },
  );
  const keys = {
    ArrowUp: "up",
    ArrowDown: "down",
    ArrowLeft: "left",
    ArrowRight: "right",
    "+": "zoom-in",
    "=": "zoom-in",
    "-": "zoom-out",
    Home: "reset",
  };
  canvas.addEventListener("keydown", (e) => {
    if (e.altKey || e.ctrlKey || e.metaKey || !keys[e.key]) return;
    e.preventDefault();
    action(keys[e.key]);
  });
  canvas.addEventListener("webglcontextlost", (e) => {
    e.preventDefault();
    generation++;
    finishFlight();
    scene = null;
    if (nextFrame) cancelAnimationFrame(nextFrame);
    nextFrame = 0;
    setState(
      "unavailable",
      "3B grafik bağlantısı kesildi. Harita görünümü kullanılabilir.",
    );
  });
  canvas.addEventListener("webglcontextrestored", () => {
    setState("idle");
    load();
  });
  new ResizeObserver(requestDraw).observe(canvas);
  new MutationObserver(() => {
    if (stage.classList.contains("atlas-raster-active")) scene?.pause();
    else requestDraw();
  }).observe(stage, { attributes:true, attributeFilter:["class"] });
  reducedMotion.addEventListener("change", () => {
    if (reducedMotion.matches) { finishFlight(); requestDraw(); }
  });
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) finishFlight();
    else requestDraw();
  });
  window.addEventListener("astro:globe", (event) => {
    const detail = event.detail || {};
    const wasActive = active;
    active = !!detail.active;
    const changed =
      missionSite && (missionSite.name !== detail.site?.name ||
        missionSite.lat !== detail.site?.lat || missionSite.lon !== detail.site?.lon);
    missionSite = detail.site || null;
    if (!exploring || changed) {
      exploring = false;
      site = detail.site || null;
    }
    if (active && changed) moveCamera(siteView());
    if (active) {
      load();
      updateButtons();
      requestDraw();
    } else if (wasActive) {
      scene?.pause();
      finishFlight();
      points.clear();
      delete stage.dataset.dragging;
      if (nextFrame) cancelAnimationFrame(nextFrame);
      nextFrame = 0;
    }
  });
  window.addEventListener("pagehide", (e) => {
    if (e.persisted) return;
    generation++;
    scene?.dispose();
    scene = null;
    if (nextFrame) cancelAnimationFrame(nextFrame);
  });

  // Invert the orthographic view on the reference sphere, excluding the sky.
  function pickSurface(clientX, clientY) {
    if (!projection || state !== "ready") return null;
    const {right, up, forward, diameter, w, h} = projection;
    const bounds = canvas.getBoundingClientRect();
    const x = (clientX - bounds.left - w / 2) / (diameter / 2);
    const y = (h / 2 - (clientY - bounds.top)) / (diameter / 2);
    if (x*x + y*y > 1) return null;
    const z = Math.sqrt(Math.max(0, 1 - x*x - y*y));
    const v = right.map((n,i) => x*n + y*up[i] + z*forward[i]);
    return {lat: Math.asin(clamp(v[1], -1, 1)) / radians,
            lon: wrap(Math.atan2(v[0], v[2]) / radians)};
  }

  function drawMarkers() {
    if (!projection) return;
    const {right, up, forward, diameter, w, h} = projection;
    let lastY = -40;
    const visible = markers.map(marker => {
      const v = surface(marker.lat, marker.lon);
      return {...marker, x:w/2+diameter/2*dot(right,v), y:h/2-diameter/2*dot(up,v),
              front:dot(forward,v)>.055};
    }).sort((a,b)=>a.y-b.y);
    const shownMarkers = visible.filter(m=>m.front && m.x>12 && m.x<w-12 && m.y>12 && m.y<h-12);
    for (const marker of shownMarkers) {
      marker.labelY = Math.max(24, marker.y, lastY+42);
      lastY = marker.labelY;
    }
    const stackShift = Math.max(0,lastY-(h-28));
    for (const marker of visible) {
      const shown = marker.front && marker.x>12 && marker.x<w-12 && marker.y>12 && marker.y<h-12;
      marker.button.hidden = !shown;
      marker.dot.hidden = !shown;
      if (!shown) continue;
      const labelY = marker.labelY - stackShift;
      marker.button.style.left = Math.max(90, Math.min(w-90, marker.x+75)) + "px";
      marker.button.style.top = Math.min(h-28,labelY) + "px";
      marker.button.classList.toggle("is-selected", marker.name === site?.name);
      marker.button.setAttribute("aria-pressed", String(marker.name === site?.name));
      marker.dot.style.left = marker.x+"px";
      marker.dot.style.top = marker.y+"px";
    }
  }

  window.astroGlobe = {
    flyTo(point) {
      if (!point || !Number.isFinite(point.lat) || !Number.isFinite(point.lon)) return;
      exploring = true;
      site = {...point};
      moveCamera({lat:clamp(point.lat,-89.99,89.99), lon:wrap(point.lon),
                  zoom:clamp(point.zoom ?? 2.6,minZoom,maxZoom)}, 650);
    },
    setMarkers(places) {
      for (const marker of markers) { marker.button.remove(); marker.dot.remove(); }
      markers = places.filter(p=>Number.isFinite(p.lat)&&Number.isFinite(p.lon)).map(point=>{
        const button=document.createElement("button");
        button.type="button"; button.className="globe-place";
        button.textContent=point.name; button.hidden=true;
        button.setAttribute("aria-label",point.name+" konumunu keşfet");
        button.addEventListener("click",()=>{
          window.astroGlobe.flyTo(point);
          window.dispatchEvent(new CustomEvent("astro:place",{detail:point}));
        });
        const dot=document.createElement("i");
        dot.className="globe-place-dot"; dot.hidden=true; dot.setAttribute("aria-hidden","true");
        stage.append(dot,button);
        return {...point,button,dot};
      });
      requestDraw();
    },
    setLighting(value) { lighting=value==="atlas"?"atlas":"relief";requestDraw(); },
    reset() { moveCamera(initial); },
    getCamera() { return {...camera}; }
  };

  setState("idle");
  window.dispatchEvent(new Event("astro:globe-ready"));
})();
