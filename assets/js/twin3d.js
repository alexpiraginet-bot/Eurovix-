/* ============================================================
   EUROVIX · Gêmeo Digital 3D (Three.js r128 UMD)
   Cupê estilizado em estúdio dark com hotspots de DVI ligados
   à saúde real do veículo. API: EVXTwin.mount(sel, opts)
   opts = { saude:{oleo,freios,pneus,bateria}, modelo, compact }
   Fallback automático quando WebGL/THREE indisponível.
   ============================================================ */

window.EVXTwin = (function () {
  'use strict';

  const instances = new Map();

  const COR = (v) => v >= 75 ? '#35C46B' : v >= 50 ? '#E8B031' : '#FF5A47';
  const LABEL = { oleo: 'Óleo', freios: 'Freios', pneus: 'Pneus', bateria: 'Bateria' };
  const POS = {
    freios: [1.18, 0.62, 0.95],
    oleo: [1.45, 0.98, 0],
    pneus: [-1.18, 0.62, -0.95],
    bateria: [-1.7, 0.88, 0.4],
  };

  function dotTexture(hex) {
    const c = document.createElement('canvas'); c.width = c.height = 64;
    const g = c.getContext('2d');
    g.beginPath(); g.arc(32, 32, 13, 0, 7); g.fillStyle = hex; g.fill();
    g.lineWidth = 4; g.strokeStyle = 'rgba(255,255,255,.92)'; g.stroke();
    return new THREE.CanvasTexture(c);
  }

  function buildCar(scene) {
    const car = new THREE.Group();
    const paint = new THREE.MeshStandardMaterial({ color: 0x232B36, metalness: 0.85, roughness: 0.3 });
    const glass = new THREE.MeshStandardMaterial({ color: 0x0B0E13, metalness: 1, roughness: 0.08 });
    const dark = new THREE.MeshStandardMaterial({ color: 0x07080B, roughness: 0.6 });
    const add = (geo, mat, x, y, z, rz) => {
      const m = new THREE.Mesh(geo, mat);
      m.position.set(x, y, z);
      if (rz) m.rotation.z = rz;
      car.add(m); return m;
    };
    add(new THREE.BoxGeometry(3.6, 0.52, 1.56), paint, 0, 0.5, 0);
    add(new THREE.BoxGeometry(1.0, 0.34, 1.5), paint, 1.45, 0.62, 0, -0.06);
    add(new THREE.BoxGeometry(1.8, 0.46, 1.34), glass, -0.25, 0.95, 0);
    add(new THREE.BoxGeometry(1.5, 0.06, 1.3), paint, -0.3, 1.2, 0);
    add(new THREE.BoxGeometry(0.75, 0.5, 1.3), glass, 0.75, 0.9, 0, -0.55);
    add(new THREE.BoxGeometry(0.6, 0.48, 1.3), glass, -1.3, 0.9, 0, 0.5);
    add(new THREE.BoxGeometry(0.06, 0.22, 0.75), dark, 1.95, 0.52, 0);
    add(new THREE.BoxGeometry(0.05, 0.07, 1.3),
      new THREE.MeshStandardMaterial({ color: 0xBFDCFF, emissive: 0xBFDCFF, emissiveIntensity: 2.2 }), 1.95, 0.68, 0);
    add(new THREE.BoxGeometry(0.05, 0.07, 1.42),
      new THREE.MeshStandardMaterial({ color: 0xE63928, emissive: 0xE63928, emissiveIntensity: 2.4 }), -1.82, 0.72, 0);
    const pneuGeo = new THREE.CylinderGeometry(0.36, 0.36, 0.28, 28);
    const aroGeo = new THREE.CylinderGeometry(0.15, 0.15, 0.30, 20);
    const aroMat = new THREE.MeshStandardMaterial({ color: 0xB9C0CB, metalness: 1, roughness: 0.25 });
    [[1.18, 0.8], [1.18, -0.8], [-1.18, 0.8], [-1.18, -0.8]].forEach(([x, z]) => {
      const p = new THREE.Mesh(pneuGeo, dark); p.rotation.x = Math.PI / 2; p.position.set(x, 0.36, z); car.add(p);
      const a = new THREE.Mesh(aroGeo, aroMat); a.rotation.x = Math.PI / 2; a.position.set(x, 0.36, z); car.add(a);
    });
    scene.add(car);
    return car;
  }

  function mount(sel, opts) {
    const box = typeof sel === 'string' ? document.querySelector(sel) : sel;
    if (!box) return;
    opts = opts || {};

    // desmonta instância anterior deste container (re-render do app)
    const prev = instances.get(box.id || sel);
    if (prev) prev.dispose();

    if (!window.THREE || !window.WebGLRenderingContext) {
      box.innerHTML = '<div style="display:flex;align-items:center;justify-content:center;height:100%;color:#8E8E8E;font-size:12px;padding:20px;text-align:center">Visualização 3D indisponível neste navegador.<br>A inspeção digital continua disponível na lista de saúde abaixo.</div>';
      return;
    }

    box.innerHTML = '';
    box.style.position = 'relative';
    const W = () => box.clientWidth || 320;
    const H = () => box.clientHeight || 230;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x0A0A0A);
    scene.fog = new THREE.Fog(0x0A0A0A, 14, 26);

    const camera = new THREE.PerspectiveCamera(34, W() / H(), 0.1, 100);
    const camR = opts.compact ? 6.4 : 7.4;
    let theta = 0.9, phi = 1.15;
    const applyCam = () => {
      camera.position.set(
        camR * Math.sin(phi) * Math.cos(theta),
        camR * Math.cos(phi),
        camR * Math.sin(phi) * Math.sin(theta)
      );
      camera.lookAt(0, 0.45, 0);
    };
    applyCam();

    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(W(), H());
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    box.appendChild(renderer.domElement);
    renderer.domElement.style.cssText = 'display:block;width:100%;height:100%;touch-action:none;cursor:grab';

    // estúdio
    const ground = new THREE.Mesh(
      new THREE.CircleGeometry(11, 64),
      new THREE.MeshStandardMaterial({ color: 0x0D1117, roughness: 0.85 })
    );
    ground.rotation.x = -Math.PI / 2;
    scene.add(ground);
    const grid = new THREE.PolarGridHelper(11, 12, 8, 64, 0x1a2029, 0x141920);
    grid.position.y = 0.002;
    scene.add(grid);
    scene.add(new THREE.HemisphereLight(0xAECBF2, 0x14181F, 0.85));
    const key = new THREE.DirectionalLight(0xffffff, 1.5);
    key.position.set(6, 8, 4); scene.add(key);
    const azul = new THREE.PointLight(0x1C69D4, 3.2, 20); azul.position.set(-4.5, 2.4, -3.2); scene.add(azul);
    const verm = new THREE.PointLight(0xE63928, 2.0, 18); verm.position.set(4.5, 1.8, 3.4); scene.add(verm);

    buildCar(scene);

    // hotspots pela saúde real
    const saude = opts.saude || { oleo: 78, freios: 64, pneus: 82, bateria: 91 };
    const sprites = [];
    Object.keys(POS).forEach((k) => {
      if (saude[k] == null) return;
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: dotTexture(COR(saude[k])), depthTest: false }));
      s.position.set(...POS[k]);
      s.scale.setScalar(0.34);
      s.userData = { k, v: saude[k] };
      scene.add(s); sprites.push(s);
    });

    // tooltip HTML
    const tip = document.createElement('div');
    tip.style.cssText = 'position:absolute;pointer-events:none;background:#fff;color:#262626;font:600 11px/1.4 Inter,system-ui,sans-serif;padding:7px 10px;border-radius:4px;box-shadow:0 8px 24px rgba(0,0,0,.35);opacity:0;transition:opacity .15s;white-space:nowrap;z-index:5';
    box.appendChild(tip);

    // interação: arrastar p/ girar + raycast nos hotspots
    const ray = new THREE.Raycaster();
    const mouse = new THREE.Vector2();
    let dragging = false, px = 0, py = 0, auto = true;
    const el = renderer.domElement;
    el.addEventListener('pointerdown', (e) => { dragging = true; auto = false; px = e.clientX; py = e.clientY; el.style.cursor = 'grabbing'; el.setPointerCapture(e.pointerId); });
    el.addEventListener('pointermove', (e) => {
      const r = el.getBoundingClientRect();
      mouse.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
      if (dragging) {
        theta += (e.clientX - px) * 0.008;
        phi = Math.min(1.45, Math.max(0.6, phi - (e.clientY - py) * 0.005));
        px = e.clientX; py = e.clientY;
        applyCam();
      } else {
        ray.setFromCamera(mouse, camera);
        const hit = ray.intersectObjects(sprites)[0];
        if (hit) {
          const { k, v } = hit.object.userData;
          tip.textContent = `${LABEL[k]} · ${v}%` + (v < 50 ? ' — atenção' : v < 75 ? ' — monitorar' : ' — ok');
          const p = hit.object.position.clone().project(camera);
          tip.style.left = ((p.x * 0.5 + 0.5) * r.width + 10) + 'px';
          tip.style.top = ((-p.y * 0.5 + 0.5) * r.height - 12) + 'px';
          tip.style.opacity = '1';
          el.style.cursor = 'pointer';
        } else {
          tip.style.opacity = '0';
          el.style.cursor = 'grab';
        }
      }
    });
    el.addEventListener('pointerup', () => { dragging = false; el.style.cursor = 'grab'; setTimeout(() => auto = true, 4000); });
    el.addEventListener('pointerleave', () => { tip.style.opacity = '0'; });

    let raf = 0, t = 0, alive = true;
    function loop() {
      if (!alive) return;
      raf = requestAnimationFrame(loop);
      t += 0.016;
      if (auto) { theta += 0.004; applyCam(); }
      sprites.forEach((s, i) => s.scale.setScalar(0.30 + Math.sin(t * 2 + i) * 0.045));
      renderer.render(scene, camera);
    }
    loop();

    const onResize = () => {
      camera.aspect = W() / H();
      camera.updateProjectionMatrix();
      renderer.setSize(W(), H());
    };
    window.addEventListener('resize', onResize);

    const inst = {
      dispose() {
        alive = false;
        cancelAnimationFrame(raf);
        window.removeEventListener('resize', onResize);
        renderer.dispose();
        if (renderer.domElement.parentNode) renderer.domElement.parentNode.removeChild(renderer.domElement);
      }
    };
    instances.set(box.id || sel, inst);
    return inst;
  }

  return { mount };
})();
