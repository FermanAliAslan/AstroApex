/* Local, on-demand WebGL2 renderer for the single textured Blender Moon mesh.
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
  const minZoom = 0.72;
  const maxZoom = 4;
  let site = null;
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
  function knownSite() {
    return (
      site &&
      Number.isFinite(site.lat) &&
      Number.isFinite(site.lon) &&
      Math.abs(site.lat) <= 90
    );
  }
  function updateButtons() {
    for (const control of controls) {
      const action = control.dataset.globe;
      control.disabled =
        state !== "ready" ||
        (action === "focus" && !knownSite()) ||
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

  const vertexSource = `#version 300 es
    precision highp float;
    in vec3 aPosition;
    in vec3 aNormal;
    in vec2 aUV;
    in vec4 aTangent;
    uniform mat3 uView;
    uniform vec2 uScale;
    out vec3 vNormal;
    out vec4 vTangent;
    out vec2 vUV;
    void main() {
      vec3 pos = uView * aPosition;
      gl_Position = vec4(pos.xy * uScale, -pos.z * .8, 1.);
      vNormal = uView * aNormal;
      vTangent = vec4(uView * aTangent.xyz, aTangent.w);
      vUV = aUV;
    }`;
  const fragmentSource = `#version 300 es
    precision highp float;
    in vec3 vNormal;
    in vec4 vTangent;
    in vec2 vUV;
    uniform sampler2D uColor;
    uniform sampler2D uDetail;
    uniform bool uHasDetail;
    out vec4 fragColor;
    void main() {
      vec3 n = normalize(vNormal);
      if (uHasDetail) {
        vec3 t = normalize(vTangent.xyz - n * dot(n, vTangent.xyz));
        vec3 b = cross(n, t) * vTangent.w;
        vec3 detail = texture(uDetail, vUV).xyz * 2. - 1.;
        n = normalize(mat3(t,b,n) * detail);
      }
      vec3 albedo = texture(uColor, vUV).rgb;
      float light = max(dot(n, normalize(vec3(-.72,.47,.77))), 0.);
      vec3 lit = pow(albedo,vec3(2.2)) * (.085 + 1.28 * light);
      fragColor = vec4(pow(lit, vec3(1. / 2.2)), 1.);
    }`;

  // Blender's packaged GLB uses one identity-transform node and one primitive.
  function unpack(buffer) {
    const header = new DataView(buffer);
    if (
      header.getUint32(0, true) !== 0x46546c67 ||
      header.getUint32(4, true) !== 2
    )
      throw new Error("Expected a glTF 2.0 binary");
    let model, binary;
    for (let pos = 12; pos < buffer.byteLength; ) {
      const length = header.getUint32(pos, true);
      const type = header.getUint32(pos + 4, true);
      const data = new Uint8Array(buffer, pos + 8, length);
      if (type === 0x4e4f534a)
        model = JSON.parse(new TextDecoder().decode(data));
      if (type === 0x004e4942) binary = data;
      pos += 8 + length;
    }
    if (!model || !binary) throw new Error("Moon mesh data missing");
    return { model, binary };
  }

  async function prepare(gl, glb, epoch) {
    const { model, binary } = unpack(glb);
    const primitive = model.meshes[0].primitives[0];
    const material = model.materials[primitive.material];
    const cleanup = [];
    const dispose = () => {
      for (const release of cleanup.reverse()) release();
      cleanup.length = 0;
    };
    const assertCurrent = () => {
      if (epoch !== generation || gl.isContextLost())
        throw new Error("WebGL context changed");
    };
    try {
      const program = gl.createProgram();
      cleanup.push(() => gl.deleteProgram(program));
      for (const [type, source] of [
        [gl.VERTEX_SHADER, vertexSource],
        [gl.FRAGMENT_SHADER, fragmentSource],
      ]) {
        const shader = gl.createShader(type);
        gl.shaderSource(shader, source);
        gl.compileShader(shader);
        gl.attachShader(program, shader);
        gl.deleteShader(shader);
      }
      gl.linkProgram(program);
      if (!gl.getProgramParameter(program, gl.LINK_STATUS))
        throw new Error(gl.getProgramInfoLog(program));
      gl.useProgram(program);
      const vao = gl.createVertexArray();
      cleanup.push(() => gl.deleteVertexArray(vao));
      gl.bindVertexArray(vao);
      function readView(index) {
        const view = model.bufferViews[index];
        return binary.subarray(
          view.byteOffset || 0,
          (view.byteOffset || 0) + view.byteLength,
        );
      }
      const buffers = new Map();
      function bind(index, target) {
        if (!buffers.has(index)) {
          const buffer = gl.createBuffer();
          cleanup.push(() => gl.deleteBuffer(buffer));
          buffers.set(index, buffer);
          gl.bindBuffer(target, buffer);
          gl.bufferData(target, readView(index), gl.STATIC_DRAW);
        } else gl.bindBuffer(target, buffers.get(index));
      }
      const attributes = [
        ["POSITION", "aPosition", 3],
        ["NORMAL", "aNormal", 3],
        ["TEXCOORD_0", "aUV", 2],
        ["TANGENT", "aTangent", 4],
      ];
      for (const [key, name, size] of attributes) {
        const location = gl.getAttribLocation(program, name);
        const accessor = model.accessors[primitive.attributes[key]];
        if (!accessor && key === "TANGENT") {
          gl.vertexAttrib4f(location, 1, 0, 0, 1);
          continue;
        }
        bind(accessor.bufferView, gl.ARRAY_BUFFER);
        gl.enableVertexAttribArray(location);
        gl.vertexAttribPointer(
          location,
          size,
          accessor.componentType,
          !!accessor.normalized,
          model.bufferViews[accessor.bufferView].byteStride || 0,
          accessor.byteOffset || 0,
        );
      }
      const indices = model.accessors[primitive.indices];
      bind(indices.bufferView, gl.ELEMENT_ARRAY_BUFFER);
      gl.bindVertexArray(null);
      const urls = [];
      async function createTexture(textureInfo) {
        const image = model.images[model.textures[textureInfo.index].source];
        const url = URL.createObjectURL(
          new Blob([readView(image.bufferView)], { type: image.mimeType }),
        );
        urls.push(url);
        const source = new Image();
        source.src = url;
        await source.decode();
        assertCurrent();
        const texture = gl.createTexture();
        cleanup.push(() => gl.deleteTexture(texture));
        gl.bindTexture(gl.TEXTURE_2D, texture);
        gl.texImage2D(
          gl.TEXTURE_2D,
          0,
          gl.RGBA,
          gl.RGBA,
          gl.UNSIGNED_BYTE,
          source,
        );
        gl.texParameteri(
          gl.TEXTURE_2D,
          gl.TEXTURE_MIN_FILTER,
          gl.LINEAR_MIPMAP_LINEAR,
        );
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        gl.generateMipmap(gl.TEXTURE_2D);
        return texture;
      }
      let color, detail;
      try {
        color = await createTexture(
          material.pbrMetallicRoughness.baseColorTexture,
        );
        if (
          material.normalTexture &&
          primitive.attributes.TANGENT !== undefined
        )
          detail = await createTexture(material.normalTexture);
      } finally {
        for (const url of urls) URL.revokeObjectURL(url);
      }
      assertCurrent();
      gl.useProgram(program);
      gl.uniform1i(gl.getUniformLocation(program, "uColor"), 0);
      gl.uniform1i(gl.getUniformLocation(program, "uDetail"), 1);
      gl.uniform1i(
        gl.getUniformLocation(program, "uHasDetail"),
        detail ? 1 : 0,
      );
      gl.enable(gl.DEPTH_TEST);
      gl.enable(gl.CULL_FACE);
      gl.clearColor(0, 0, 0, 0);
      const view = gl.getUniformLocation(program, "uView");
      const scale = gl.getUniformLocation(program, "uScale");
      return {
        draw(matrix, xScale, yScale) {
          gl.viewport(0, 0, canvas.width, canvas.height);
          gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
          gl.useProgram(program);
          gl.bindVertexArray(vao);
          gl.activeTexture(gl.TEXTURE0);
          gl.bindTexture(gl.TEXTURE_2D, color);
          gl.activeTexture(gl.TEXTURE1);
          gl.bindTexture(gl.TEXTURE_2D, detail || color);
          gl.uniformMatrix3fv(view, false, matrix);
          gl.uniform2f(scale, xScale, yScale);
          gl.drawElements(
            gl.TRIANGLES,
            indices.count,
            indices.componentType,
            indices.byteOffset || 0,
          );
        },
        dispose,
      };
    } catch (error) {
      dispose();
      throw error;
    }
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
      const response = await fetch("assets/moon-globe.glb");
      if (!response.ok) throw new Error("Moon mesh HTTP " + response.status);
      const model = await response.arrayBuffer();
      if (epoch !== generation) return;
      scene = await prepare(context, model, epoch);
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
    scene.draw(view, diameter / w, diameter / h);
    if (!knownSite()) {
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
      case "focus": return moveCamera(siteView());
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
      site &&
      detail.site &&
      (site.name !== detail.site.name ||
        site.lat !== detail.site.lat ||
        site.lon !== detail.site.lon);
    site = detail.site || null;
    if (active && changed) moveCamera(siteView());
    if (active) {
      load();
      updateButtons();
      requestDraw();
    } else if (wasActive) {
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
  setState("idle");
  window.dispatchEvent(new Event("astro:globe-ready"));
})();
