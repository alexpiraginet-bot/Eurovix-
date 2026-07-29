/* ============================================================
   LexOS · WERK OS — carro 3D interativo de avarias
   ------------------------------------------------------------
   Visualizador 3D 100% próprio (CSS 3D transforms, sem nenhuma
   biblioteca externa). Arraste para girar, pinça/scroll p/ zoom.
   As avarias ficam "coladas" no corpo do carro e giram junto.
   Clique num painel para marcar; clique num pino para remover.

   API:
     const v = WERK3D.mount(container, {
       danos, onAdd(dano), onPick(index), view, onView, readonly
     });
     v.setDanos(lista);  v.getView();  v.destroy();

   Modelo de dado do dano (retrocompatível com a silhueta 2D):
     { x, y, nota, ia?, face?, fx?, fy? }
     - x,y  : % na projeção de topo (usados pelo documento/Termo)
     - face : painel tocado no 3D ('top'|'left'|'right'|'front'|
              'back'|'hood'|'roof'); fx,fy = % local nesse painel.
   ============================================================ */
(function (global) {
  'use strict';
  const STYLE_ID = 'wk3d-style';

  // Dimensões do carro (unidades de tela). Comprimento no eixo Z.
  const CAR = { w: 116, h: 44, d: 262 };          // corpo
  const CAB = { w: 100, h: 42, d: 118, z: -14 };  // cabine (recuada p/ trás)

  function injectStyle() {
    if (document.getElementById(STYLE_ID)) return;
    const css = `
    .wk3d{position:relative;width:100%;height:100%;min-height:230px;overflow:hidden;
      border-radius:12px;touch-action:none;cursor:grab;user-select:none;
      background:radial-gradient(120% 90% at 50% 18%,#121826 0%,#0a0e16 55%,#06080d 100%);}
    .wk3d:active{cursor:grabbing;}
    .wk3d__scene{position:absolute;inset:0;perspective:920px;perspective-origin:50% 42%;}
    .wk3d__rig{position:absolute;left:50%;top:54%;width:0;height:0;transform-style:preserve-3d;
      transition:transform .06s linear;}
    .wk3d__car{position:absolute;transform-style:preserve-3d;}
    .wk3d-face{position:absolute;left:0;top:0;transform-style:preserve-3d;
      backface-visibility:hidden;box-sizing:border-box;overflow:visible;
      border:1px solid rgba(120,150,200,.14);}
    .wk3d-body{background:linear-gradient(150deg,#39414f 0%,#262c37 46%,#161a22 100%);
      box-shadow:inset 0 0 22px rgba(0,0,0,.4);}
    .wk3d-body.top{background:linear-gradient(160deg,#48515f 0%,#333a47 55%,#232833 100%);}
    .wk3d-body.bottom{background:#0b0d12;}
    .wk3d-glass{background:linear-gradient(160deg,rgba(120,170,235,.42),rgba(30,58,110,.62));
      border-color:rgba(150,190,240,.3);box-shadow:inset 0 0 14px rgba(140,180,240,.25);}
    .wk3d-glass.top{background:linear-gradient(160deg,rgba(150,195,245,.5),rgba(40,72,128,.55));}
    .wk3d-wheel{position:absolute;border-radius:50%;
      background:radial-gradient(circle at 50% 42%,#3a4150 0 20%,#14171f 46%,#05070b 72%,#0b0e14 100%);
      border:2px solid #05070b;box-shadow:0 0 8px rgba(0,0,0,.6);}
    .wk3d-shadow{position:absolute;left:50%;top:50%;width:300px;height:150px;
      transform:translate(-50%,-50%) rotateX(90deg) translateZ(-24px);
      background:radial-gradient(ellipse,rgba(0,0,0,.5) 0%,rgba(0,0,0,0) 70%);pointer-events:none;}
    .wk3d-pin{position:absolute;width:22px;height:22px;margin:-11px 0 0 -11px;border-radius:50% 50% 50% 2px;
      transform:rotate(45deg);cursor:pointer;backface-visibility:hidden;
      background:linear-gradient(160deg,#ff5b52,#d0241d);border:1.5px solid #ffd7d3;
      box-shadow:0 2px 7px rgba(0,0,0,.5);display:flex;align-items:center;justify-content:center;}
    .wk3d-pin.ia{background:linear-gradient(160deg,#8b8ff0,#5a5fea);border-color:#dcdcff;}
    .wk3d-pin b{transform:rotate(-45deg);font:700 10px/1 system-ui,sans-serif;color:#fff;}
    .wk3d__ui{position:absolute;left:0;right:0;bottom:8px;text-align:center;pointer-events:none;
      font:600 10.5px/1.4 system-ui,sans-serif;color:#8fa0bd;letter-spacing:.02em;}
    .wk3d__reset{position:absolute;top:8px;right:8px;pointer-events:auto;cursor:pointer;
      font:600 11px/1 system-ui,sans-serif;color:#b9c6dd;background:rgba(20,26,38,.7);
      border:1px solid rgba(120,150,200,.25);border-radius:8px;padding:5px 9px;}
    .wk3d__reset:hover{color:#fff;border-color:rgba(150,180,235,.5);}
    .wk3d-real{position:relative;width:100%;height:100%;min-height:280px;border-radius:12px;overflow:hidden;background:#0a0e16;}
    /* acabamento neutro/"matcap": sem cor — padrão para todos os carros */
    .wk3d-real iframe{width:100%;height:100%;border:0;display:block;filter:grayscale(1) contrast(1.04) brightness(1.03);}
    .wk3d-attrib{position:absolute;left:8px;bottom:8px;z-index:2;font:600 9.5px/1.3 system-ui,sans-serif;
      color:#8fa0bd;background:rgba(10,14,22,.74);border:1px solid rgba(120,150,200,.2);
      border-radius:7px;padding:4px 8px;pointer-events:auto;}
    .wk3d-attrib a{color:#c7d3e6;text-decoration:none;} .wk3d-attrib a:hover{text-decoration:underline;}`;
    const s = document.createElement('style');
    s.id = STYLE_ID; s.textContent = css;
    document.head.appendChild(s);
  }

  // Cria uma face de caixa, centrada na origem do wrapper (margem) e
  // posicionada/rotacionada em 3D pela transform.
  function face(cls, w, h, transform) {
    const el = document.createElement('div');
    el.className = 'wk3d-face ' + cls;
    el.style.width = w + 'px'; el.style.height = h + 'px';
    el.style.left = '0'; el.style.top = '0';
    el.style.marginLeft = (-w / 2) + 'px'; el.style.marginTop = (-h / 2) + 'px';
    el.style.transform = transform;
    return el;
  }

  // Monta as 6 faces de uma caixa (largura W=x, altura H=y, profundidade D=z)
  // dentro de um wrapper deslocado (offY p/ cima, offZ p/ trás) no espaço do carro.
  function box(parent, W, H, D, faceMap, offY, offZ) {
    offY = offY || 0; offZ = offZ || 0;
    const wrap = document.createElement('div');
    wrap.style.position = 'absolute'; wrap.style.left = '0'; wrap.style.top = '0';
    wrap.style.transformStyle = 'preserve-3d';
    wrap.style.transform = 'translateY(' + (-offY) + 'px) translateZ(' + offZ + 'px)';
    const F = [
      ['front',  W, H, 'translateZ(' + (D / 2) + 'px)'],
      ['back',   W, H, 'rotateY(180deg) translateZ(' + (D / 2) + 'px)'],
      ['right',  D, H, 'rotateY(90deg) translateZ(' + (W / 2) + 'px)'],
      ['left',   D, H, 'rotateY(-90deg) translateZ(' + (W / 2) + 'px)'],
      ['top',    W, D, 'rotateX(90deg) translateZ(' + (H / 2) + 'px)'],
      ['bottom', W, D, 'rotateX(-90deg) translateZ(' + (H / 2) + 'px)'],
    ];
    const out = {};
    for (const [side, w, h, tr] of F) {
      const spec = faceMap[side] || { cls: 'wk3d-body' };
      const el = face(spec.cls + (spec.mod ? ' ' + spec.mod : ''), w, h, tr);
      if (spec.face) el.dataset.face = spec.face;   // marcável
      wrap.appendChild(el); out[side] = el;
    }
    parent.appendChild(wrap);
    return out;
  }

  function wheel(parent, x, z) {
    const r = 36;
    const w = document.createElement('div');
    w.className = 'wk3d-wheel';
    w.style.width = w.style.height = r + 'px';
    w.style.left = '0'; w.style.top = '0';
    w.style.marginLeft = w.style.marginTop = (-r / 2) + 'px';
    w.style.transform = 'translateX(' + x + 'px) translateY(' + (CAR.h / 2 - 3) + 'px) translateZ(' + z + 'px) rotateY(90deg)';
    parent.appendChild(w);
    return w;
  }

  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }

  function mount(container, opts) {
    if (!container) throw new Error('WERK3D: container ausente');
    opts = opts || {};
    injectStyle();
    container.innerHTML = '';
    container.classList.add('wk3d');

    const scene = document.createElement('div'); scene.className = 'wk3d__scene';
    const rig = document.createElement('div'); rig.className = 'wk3d__rig';
    const car = document.createElement('div'); car.className = 'wk3d__car';
    rig.appendChild(car); scene.appendChild(rig); container.appendChild(scene);

    // sombra no chão
    const shadow = document.createElement('div'); shadow.className = 'wk3d-shadow';
    car.appendChild(shadow);

    // corpo (marcável em todos os lados)
    const bodyFaces = box(car, CAR.w, CAR.h, CAR.d, {
      front:  { cls: 'wk3d-body', face: 'front' },
      back:   { cls: 'wk3d-body', face: 'back' },
      left:   { cls: 'wk3d-body', face: 'left' },
      right:  { cls: 'wk3d-body', face: 'right' },
      top:    { cls: 'wk3d-body', mod: 'top', face: 'hood' },
      bottom: { cls: 'wk3d-body', mod: 'bottom' },
    });
    // cabine / vidros (topo marcável = teto)
    box(car, CAB.w, CAB.h, CAB.d, {
      front:  { cls: 'wk3d-glass' },
      back:   { cls: 'wk3d-glass' },
      left:   { cls: 'wk3d-glass' },
      right:  { cls: 'wk3d-glass' },
      top:    { cls: 'wk3d-glass', mod: 'top', face: 'roof' },
      bottom: { cls: 'wk3d-body' },
    }, CAR.h / 2 + CAB.h / 2 - 2, CAB.z);
    // rodas
    wheel(car, CAR.w / 2, CAR.d / 2 - 52);
    wheel(car, -CAR.w / 2, CAR.d / 2 - 52);
    wheel(car, CAR.w / 2, -CAR.d / 2 + 52);
    wheel(car, -CAR.w / 2, -CAR.d / 2 + 52);

    // pinos vivem dentro das faces (herdam o 3D)
    const pinLayerByFace = {
      hood: bodyFaces.top, roof: null, top: bodyFaces.top,
      front: bodyFaces.front, back: bodyFaces.back, left: bodyFaces.left, right: bodyFaces.right,
    };
    // o teto (roof) é uma face da cabine — recupere-a
    pinLayerByFace.roof = car.querySelector('.wk3d-glass.top[data-face="roof"]');

    // ---- estado de câmera ----
    const DEF = { rx: -20, ry: -38, z: 1 };
    let view = Object.assign({}, DEF, opts.view || {});
    function applyView() {
      rig.style.transform = 'rotateX(' + view.rx + 'deg) rotateY(' + view.ry + 'deg) scale(' + view.z + ')';
      if (opts.onView) opts.onView(getView());
    }
    function getView() { return { rx: view.rx, ry: view.ry, z: view.z }; }

    // ---- render dos pinos ----
    let danos = (opts.danos || []).slice();
    function pinFace(d) {
      if (d.face && pinLayerByFace[d.face]) return { layer: pinLayerByFace[d.face], fx: d.fx, fy: d.fy };
      return { layer: bodyFaces.top, fx: d.x, fy: d.y };  // legado/IA/2D → projeção de topo
    }
    function renderPins() {
      container.querySelectorAll('.wk3d-pin').forEach(p => p.remove());
      danos.forEach((d, i) => {
        const { layer, fx, fy } = pinFace(d);
        if (!layer) return;
        const pin = document.createElement('div');
        pin.className = 'wk3d-pin' + (d.ia ? ' ia' : '');
        pin.style.left = clamp(+fx || 50, 0, 100) + '%';
        pin.style.top = clamp(+fy || 50, 0, 100) + '%';
        pin.innerHTML = '<b>' + (i + 1) + '</b>';
        pin.title = d.nota || '';
        pin.addEventListener('pointerup', (e) => { e.stopPropagation(); if (opts.onPick) opts.onPick(i); });
        layer.appendChild(pin);
      });
    }

    // topo (x/y%) aproximado a partir da face+coord local — mantém o Termo/silhueta coerente
    function toTopView(faceName, fx, fy) {
      switch (faceName) {
        case 'left':  return { x: 7,  y: fx };
        case 'right': return { x: 93, y: fx };
        case 'front': return { x: fx, y: 8 };
        case 'back':  return { x: fx, y: 92 };
        default:      return { x: fx, y: fy };   // hood/roof/top
      }
    }

    // ---- interação: girar / zoom / marcar ----
    let drag = null, moved = 0, pointers = new Map(), pinchStart = null;
    function onDown(e) {
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pointers.size === 1) { drag = { x: e.clientX, y: e.clientY, ry: view.ry, rx: view.rx, target: e.target }; moved = 0; }
      else if (pointers.size === 2) { pinchStart = { d: pDist(), z: view.z }; drag = null; }
      container.setPointerCapture && container.setPointerCapture(e.pointerId);
    }
    function pDist() {
      const p = [...pointers.values()]; if (p.length < 2) return 0;
      return Math.hypot(p[0].x - p[1].x, p[0].y - p[1].y);
    }
    function onMove(e) {
      if (pointers.has(e.pointerId)) pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pointers.size === 2 && pinchStart) {
        const f = pDist() / (pinchStart.d || 1);
        view.z = clamp(pinchStart.z * f, 0.6, 2.2); applyView(); return;
      }
      if (!drag) return;
      const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
      moved += Math.abs(dx) + Math.abs(dy);
      view.ry = drag.ry + dx * 0.4;
      view.rx = clamp(drag.rx - dy * 0.4, -88, -8);
      applyView();
    }
    function onUp(e) {
      const wasTap = drag && moved < 6;
      const tgt = drag && drag.target;
      pointers.delete(e.pointerId); if (pointers.size < 2) pinchStart = null;
      if (wasTap && !opts.readonly && tgt && tgt.dataset && tgt.dataset.face) {
        const faceName = tgt.dataset.face;
        const fx = clamp(e.offsetX / tgt.offsetWidth * 100, 0, 100);
        const fy = clamp(e.offsetY / tgt.offsetHeight * 100, 0, 100);
        const tv = toTopView(faceName, fx, fy);
        if (opts.onAdd) opts.onAdd({ x: Math.round(tv.x), y: Math.round(tv.y), face: faceName, fx: Math.round(fx), fy: Math.round(fy) });
      }
      drag = null;
    }
    function onWheel(e) { e.preventDefault(); view.z = clamp(view.z * (e.deltaY < 0 ? 1.1 : 0.9), 0.6, 2.2); applyView(); }

    container.addEventListener('pointerdown', onDown);
    container.addEventListener('pointermove', onMove);
    container.addEventListener('pointerup', onUp);
    container.addEventListener('pointercancel', onUp);
    container.addEventListener('wheel', onWheel, { passive: false });

    // UI
    const ui = document.createElement('div'); ui.className = 'wk3d__ui';
    ui.textContent = opts.readonly ? 'arraste para girar' : 'arraste para girar · toque num painel para marcar';
    container.appendChild(ui);
    const reset = document.createElement('div'); reset.className = 'wk3d__reset'; reset.textContent = '⟲ vista';
    reset.addEventListener('pointerup', (e) => { e.stopPropagation(); view = Object.assign({}, DEF); applyView(); });
    container.appendChild(reset);

    applyView(); renderPins();

    return {
      setDanos(l) { danos = (l || []).slice(); renderPins(); },
      getView, getDanos() { return danos.slice(); },
      destroy() {
        container.removeEventListener('pointerdown', onDown);
        container.removeEventListener('pointermove', onMove);
        container.removeEventListener('pointerup', onUp);
        container.removeEventListener('pointercancel', onUp);
        container.removeEventListener('wheel', onWheel);
        container.classList.remove('wk3d'); container.innerHTML = '';
      },
    };
  }

  /* ---------------------------------------------------------
     Modelo 3D REAL do carro — showcase via embed da Sketchfab.
     A MARCAÇÃO de avarias continua no carro 3D próprio (offline),
     que é genérico e vale para qualquer veículo.

     Cada entrada carrega o SEU crédito. A legenda antes era fixa
     num autor só; com modelos de autores diferentes isso passaria
     a creditar a pessoa errada — o que quebra justamente a licença
     que nos deixa usar o modelo.

     `com: true` = a licença permite uso comercial (CC BY / CC BY-SA
     / CC0). Os BMW abaixo são CC BY-NC-SA, ou seja NÃO comercial:
     servem para demonstração com atribuição, mas precisam ser
     licenciados com o autor ou trocados antes de o sistema ser
     vendido com eles dentro.
     --------------------------------------------------------- */
  const CAT = [
    // — Porsche / Audi (licença comercial) —
    { re: /macan/,                    uid: 'b61426730e5f49c0a73c48f0004406c5', autor: 'Ddiaz Design',      url: 'https://sketchfab.com/ddiaz-design',  lic: 'CC BY',    com: true },
    { re: /cayenne/,                  uid: '74fbea5a4dfc4197839fdd2bf654369a', autor: 'Ddiaz Design',      url: 'https://sketchfab.com/ddiaz-design',  lic: 'CC BY',    com: true },
    { re: /\bq5\b/,                   uid: '9cf08cf1dac24654a34dbdad76cce52c', autor: 'tonielpro520',      url: 'https://sketchfab.com/tonielpro520',  lic: 'CC BY',    com: true },
    { re: /911|carrera|\b99[12]\b/,   uid: 'd01b254483794de3819786d93e0e1ebf', autor: 'Lionsharp Studios', url: 'https://sketchfab.com/lionsharp',     lic: 'CC BY-SA', com: true },
    // — BMW (herdado do piloto; licença NÃO comercial) —
    { re: /z4/,        uid: '6a1fd02fa5fa46488a131777c569354e', autor: 'Ddiaz Design', url: 'https://sketchfab.com/ddiaz-design', lic: 'CC BY-NC-SA' },
    { re: /\bm1\b/,    uid: '381d36aaa42e4a3a88502971f385334f', autor: 'Ddiaz Design', url: 'https://sketchfab.com/ddiaz-design', lic: 'CC BY-NC-SA' },
    { re: /750|7 ?series|s[eé]rie 7/, uid: '0c3ebd90567a409894682becd3d92efe', autor: 'Ddiaz Design', url: 'https://sketchfab.com/ddiaz-design', lic: 'CC BY-NC-SA' },
    { re: /x5/,        uid: 'b453ba441ff04f9290955d09c3d46b9f', autor: 'Ddiaz Design', url: 'https://sketchfab.com/ddiaz-design', lic: 'CC BY-NC-SA' },
    { re: /x3/,        uid: 'd35d04aac7f242d997af5d8d2d7fbeca', autor: 'Ddiaz Design', url: 'https://sketchfab.com/ddiaz-design', lic: 'CC BY-NC-SA' },
    { re: /x1|x2|x4|x6|x7/, uid: 'b453ba441ff04f9290955d09c3d46b9f', autor: 'Ddiaz Design', url: 'https://sketchfab.com/ddiaz-design', lic: 'CC BY-NC-SA' },
    { re: /m4/,        uid: 'f8141ecd755547989c9209784b71ad43', autor: 'Ddiaz Design', url: 'https://sketchfab.com/ddiaz-design', lic: 'CC BY-NC-SA' },
    { re: /cs touring|m3.*touring|touring.*m3/, uid: 'ebda8c29a8ef4ec789391e918d52ef55', autor: 'Ddiaz Design', url: 'https://sketchfab.com/ddiaz-design', lic: 'CC BY-NC-SA' },
    { re: /f80|m3\b/,  uid: '547ab5f3b534473fbef71404bae708c5', autor: 'Ddiaz Design', url: 'https://sketchfab.com/ddiaz-design', lic: 'CC BY-NC-SA' },
    { re: /m340|340i/, uid: '69dbf0293c6f4959a90d5bd0d68e097f', autor: 'Ddiaz Design', url: 'https://sketchfab.com/ddiaz-design', lic: 'CC BY-NC-SA' },
    { re: /335|gran turismo|3 ?series gt|f34/, uid: 'e4f91073e4374de5a3ff0858f25400d2', autor: 'Ddiaz Design', url: 'https://sketchfab.com/ddiaz-design', lic: 'CC BY-NC-SA' },
    { re: /m235|m135|1 ?series|2 ?series|118|120|125|218|220|228|gran coup/, uid: '1efbe2ff21414af89fb14c70655cc88b', autor: 'Ddiaz Design', url: 'https://sketchfab.com/ddiaz-design', lic: 'CC BY-NC-SA' },
    { re: /e46|328|3 ?series|320|323|325|330|s[eé]rie 3/, uid: '5fce3b693344450380b0112a4d21cfe5', autor: 'Ddiaz Design', url: 'https://sketchfab.com/ddiaz-design', lic: 'CC BY-NC-SA' },
    { re: /e30/,       uid: '9099df483850404a8cf94529b3df148b', autor: 'Ddiaz Design', url: 'https://sketchfab.com/ddiaz-design', lic: 'CC BY-NC-SA' },
    { re: /e36/,       uid: '76401039fa80419ab036bea09acb898d', autor: 'Ddiaz Design', url: 'https://sketchfab.com/ddiaz-design', lic: 'CC BY-NC-SA' },
    { re: /csl|\be9\b|3\.0/, uid: '86ee7c1a83334576933ab431542269d5', autor: 'Ddiaz Design', url: 'https://sketchfab.com/ddiaz-design', lic: 'CC BY-NC-SA' },
  ];
  // Sem modelo padrão, de propósito: mostrar o carro de outra marca (ou de outro
  // porte) como se fosse o do cliente seria mentira na tela. Quando o veículo não
  // está no catálogo, devolve null e a interface simplesmente não oferece o 3D
  // real — o carro 3D de inspeção, que é genérico e offline, segue valendo para
  // qualquer veículo. É por isso que A4 e RS3 não têm modelo: o que existe com
  // licença utilizável é de outra geração ou é maquete de cenário.
  const SEM_MODELO = null;

  function slug(s) { return String(s == null ? '' : s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim(); }

  function modeloDoCarro(modelStr) {
    const s = slug(modelStr);
    return CAT.find(c => c.re.test(s)) || SEM_MODELO;
  }
  function bmwUid(modelStr) {            // nome herdado; hoje serve qualquer marca
    const m = modeloDoCarro(modelStr);
    return m ? m.uid : null;
  }
  const temModelo3D = (modelStr) => !!modeloDoCarro(modelStr);

  // Embeda o modelo 3D real no container (iframe Sketchfab + atribuição CC obrigatória).
  function embedReal(container, modelStr, opts) {
    if (!container) throw new Error('WERK3D: container ausente');
    injectStyle(); opts = opts || {};
    const item = modeloDoCarro(modelStr);
    const uid = opts.uid || (item && item.uid);
    if (!uid) throw new Error('WERK3D: sem modelo 3D real para este veículo');
    container.classList.add('wk3d-real'); container.innerHTML = '';
    // autostart=1 → inicia sozinho (sem clique). ui_controls=0 + flags → sem a
    // barra/botões da Sketchfab por cima do carro (só o modelo, limpo e visível).
    // A atribuição CC continua na legenda abaixo. autospin gentil.
    const src = 'https://sketchfab.com/models/' + uid + '/embed'
      + '?autostart=1&preload=1&ui_theme=dark&transparent=1&dnt=1&autospin=0.25'
      + '&ui_infos=0&ui_controls=0&ui_watermark=0&ui_hint=0&ui_ar=0&ui_vr=0'
      + '&ui_fullscreen=0&ui_help=0&ui_settings=0&ui_annotations=0&ui_inspector=0';
    const ifr = document.createElement('iframe');
    ifr.title = 'Modelo 3D do veículo'; ifr.src = src; ifr.loading = 'lazy';
    ifr.setAttribute('frameborder', '0'); ifr.setAttribute('allowfullscreen', '');
    ifr.setAttribute('allow', 'autoplay; fullscreen; xr-spatial-tracking');
    container.appendChild(ifr);
    const cap = document.createElement('div');
    cap.className = 'wk3d-attrib';
    // Crédito DO MODELO exibido — a licença exige nomear quem fez aquele arquivo.
    const esc = (t) => String(t == null ? '' : t).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
    cap.innerHTML = item
      ? `Modelo 3D por <a href="${esc(item.url)}" target="_blank" rel="noopener">${esc(item.autor)}</a> · Sketchfab · ${esc(item.lic)}`
      : 'Modelo 3D · Sketchfab';
    container.appendChild(cap);
    return uid;
  }

  /* ---------------------------------------------------------
     MODELO REAL COMO PALCO DAS AVARIAS
     O embed simples é um iframe de outro domínio: não dá para
     saber onde a pessoa tocou. A API do visualizador resolve —
     o evento de clique devolve `position3D`, e a anotação criada
     a partir desse ponto fica ANCORADA na lataria: gira junto com
     o carro, some quando passa para trás. É por isso que a
     marcação aqui é referência de verdade, não um adesivo na tela.

     Degrada sozinho: sem modelo no catálogo, sem internet, ou se
     a API não responder no prazo, chama opts.onFalha e quem chamou
     volta para o carro 3D próprio (offline) sem quebrar nada.

       const v = await WERK3D.montarReal(box, 'Porsche Macan S (95B)', {
         danos, marcar: true, onAdd({p3}), onFalha(motivo)
       });
       v.marcarPonto(p3, 'CRÍTICO', 'Risco no para-choque');
     --------------------------------------------------------- */
  const SK_API = 'https://static.sketchfab.com/api/sketchfab-viewer-1.12.1.js';
  const SK_PRAZO = 15000;
  let skScript = null;

  function carregarApiSketchfab() {
    if (skScript) return skScript;
    skScript = new Promise((ok, erro) => {
      if (global.Sketchfab) return ok(global.Sketchfab);
      const s = document.createElement('script');
      s.src = SK_API; s.async = true;
      s.onload = () => (global.Sketchfab ? ok(global.Sketchfab) : erro(new Error('API carregou sem expor Sketchfab')));
      s.onerror = () => { skScript = null; erro(new Error('não deu para baixar a API da Sketchfab')); };
      document.head.appendChild(s);
    });
    return skScript;
  }

  // Severidade → rótulo curto que vai no título da anotação (a Sketchfab não
  // deixa colorir o pino, então a cor vira palavra).
  const SEV_ROTULO = { critico: '🔴 CRÍTICO', preventivo: '🟡 PREVENTIVO', ok: '🟢 OK' };

  function montarReal(container, modelStr, opts) {
    opts = opts || {};
    const falhar = (motivo) => { try { opts.onFalha && opts.onFalha(motivo); } catch (_) {} return null; };
    if (!container) return Promise.resolve(falhar('sem container'));
    const item = modeloDoCarro(modelStr);
    if (!item) return Promise.resolve(falhar('este veículo não tem modelo 3D no catálogo'));

    injectStyle();
    container.classList.add('wk3d-real');
    container.innerHTML = '';
    const ifr = document.createElement('iframe');
    ifr.title = 'Modelo 3D do veículo';
    ifr.setAttribute('allow', 'autoplay; fullscreen; xr-spatial-tracking');
    ifr.setAttribute('allowfullscreen', ''); ifr.setAttribute('frameborder', '0');
    container.appendChild(ifr);
    const cap = document.createElement('div');
    cap.className = 'wk3d-attrib';
    const esc = (t) => String(t == null ? '' : t).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
    cap.innerHTML = `Modelo 3D por <a href="${esc(item.url)}" target="_blank" rel="noopener">${esc(item.autor)}</a> · Sketchfab · ${esc(item.lic)}`;
    container.appendChild(cap);

    return carregarApiSketchfab().then((Sketchfab) => new Promise((resolve) => {
      let resolvido = false;
      const desistir = (motivo) => { if (resolvido) return; resolvido = true; resolve(falhar(motivo)); };
      const prazo = setTimeout(() => desistir('o modelo 3D não respondeu a tempo'), SK_PRAZO);

      const client = new Sketchfab(ifr);
      client.init(item.uid, {
        autostart: 1, preload: 1, ui_theme: 'dark', transparent: 1, dnt: 1,
        ui_infos: 0, ui_controls: opts.marcar ? 0 : 0, ui_watermark: 0, ui_hint: 0,
        ui_ar: 0, ui_vr: 0, ui_fullscreen: 0, ui_help: 0, ui_settings: 0, ui_inspector: 0,
        // as anotações SÃO as avarias: a barra de navegação delas fica escondida,
        // mas os pinos continuam visíveis e clicáveis.
        ui_annotations: 0, annotation_cycle: 0,
        error: () => { clearTimeout(prazo); desistir('a Sketchfab recusou carregar o modelo'); },
        success: (api) => {
          api.start();
          api.addEventListener('viewerready', () => {
            clearTimeout(prazo);
            if (resolvido) return;
            resolvido = true;

            let camera = { eye: [0, 0, 0], target: [0, 0, 0] };
            const lerCamera = () => api.getCameraLookAt((_e, c) => { if (c) camera = { eye: c.position, target: c.target }; });
            lerCamera();

            const marcarPonto = (p3, titulo, texto) => {
              try {
                api.createAnnotationFromWorldPosition(p3, camera.eye, camera.target,
                  String(titulo || 'Avaria'), String(texto || ''), function () {});
              } catch (_) {}
            };

            // avarias que já existiam entram como anotação ancorada
            (opts.danos || []).forEach((d) => {
              if (!d || !d.p3) return;
              marcarPonto(d.p3, (SEV_ROTULO[d.severidade] || '🔴 AVARIA'), d.nota || '');
            });

            if (opts.marcar && opts.onAdd) {
              api.addEventListener('click', (info) => {
                if (!info || !info.position3D || !info.instanceID) return;  // clicou no vazio
                lerCamera();
                opts.onAdd({ p3: info.position3D, sk: item.uid });
              }, { pick: 'slow' });
            }

            resolve({
              api, uid: item.uid, credito: item,
              marcarPonto,
              destruir() { try { api.stop(); } catch (_) {} try { container.innerHTML = ''; } catch (_) {} },
            });
          });
        },
      });
    })).catch((e) => falhar(e && e.message ? e.message : 'falha ao abrir o modelo 3D'));
  }

  global.WERK3D = {
    mount, embedReal, bmwUid, temModelo3D, modeloDoCarro, montarReal,
    supported: (function () {
      try { const el = document.createElement('div'); el.style.transform = 'translateZ(1px)'; return 'transformStyle' in el.style || 'webkitTransformStyle' in el.style; }
      catch (_) { return false; }
    })(),
  };
})(typeof window !== 'undefined' ? window : this);
