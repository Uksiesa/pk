'use strict';

/* ====================== KARTAN KALIBROINTI ====================== */
/* Muuta vain tätä lohkoa, jos vaihdat karttaa. */

const KARTTA = {
  tiedosto: 'kartta.jpg',
  leveys:  1204,
  korkeus:  802,
  ref: [
    { px: 151,  py: 524, E: 242511.650, N: 6950855.945 },
    { px: 1004, py: 169, E: 243364.774, N: 6951211.612 }
  ]
};

const R1 = KARTTA.ref[0], R2 = KARTTA.ref[1];
const mppX = (R2.E - R1.E) / (R2.px - R1.px);   // metriä / pikseli, itä
const mppY = (R1.N - R2.N) / (R2.py - R1.py);   // metriä / pikseli, pohjoinen
const mpp  = (mppX + mppY) / 2;

function tmPikseliksi(E, N) {
  return { x: R1.px + (E - R1.E) / mppX,
           y: R1.py - (N - R1.N) / mppY };
}

/* ============ WGS84 -> ETRS-TM35FIN (JHS154, Krüger) ============ */

const A_ELL = 6378137.0, F_ELL = 1 / 298.257222101;
const K0 = 0.9996, LON0 = 27 * Math.PI / 180, FE = 500000;
const nn = F_ELL / (2 - F_ELL);
const A1 = A_ELL / (1 + nn) * (1 + nn**2 / 4 + nn**4 / 64);
const h1 = nn/2 - (2/3)*nn**2 + (5/16)*nn**3 + (41/180)*nn**4;
const h2 = (13/48)*nn**2 - (3/5)*nn**3 + (557/1440)*nn**4;
const h3 = (61/240)*nn**3 - (103/140)*nn**4;
const h4 = (49561/161280)*nn**4;
const ee = Math.sqrt(F_ELL * (2 - F_ELL));

function wgsTm35(latDeg, lonDeg) {
  const la = latDeg * Math.PI / 180, lo = lonDeg * Math.PI / 180;
  const Q  = Math.asinh(Math.tan(la)) - ee * Math.atanh(ee * Math.sin(la));
  const b  = Math.atan(Math.sinh(Q));
  const et = Math.atanh(Math.cos(b) * Math.sin(lo - LON0));
  const xi = Math.asin(Math.sin(b) * Math.cosh(et));
  const X = xi + h1*Math.sin(2*xi)*Math.cosh(2*et) + h2*Math.sin(4*xi)*Math.cosh(4*et)
               + h3*Math.sin(6*xi)*Math.cosh(6*et) + h4*Math.sin(8*xi)*Math.cosh(8*et);
  const Y = et + h1*Math.cos(2*xi)*Math.sinh(2*et) + h2*Math.cos(4*xi)*Math.sinh(4*et)
               + h3*Math.cos(6*xi)*Math.sinh(6*et) + h4*Math.cos(8*xi)*Math.sinh(8*et);
  return { N: A1 * X * K0, E: A1 * Y * K0 + FE };
}

/* ========================== TILA ========================== */

const cv  = document.getElementById('kartta');
const ctx = cv.getContext('2d');
const el = {
  koord:    document.getElementById('koord'),
  tarkkuus: document.getElementById('tarkkuus'),
  syke:     document.getElementById('syke'),
  viesti:   document.getElementById('viesti'),
  seuraa:   document.getElementById('nappi-seuraa'),
  kompassi: document.getElementById('nappi-kompassi'),
  jana:     document.getElementById('janaviiva'),
  janat:    document.getElementById('janateksti')
};

let kuva = null, kuvaValmis = false;
let skaala = 1, tx = 0, ty = 0, minSkaala = 0.2, maxSkaala = 8;
let seuraa = true;
let sijainti = null;              // { x, y, E, N, tarkkuus }
let kompassiSuunta = null, gpsSuunta = null;
let piirtoPyynto = null;

const dpr = () => Math.min(window.devicePixelRatio || 1, 3);
const rajaa = (v, a, b) => Math.max(a, Math.min(b, v));

/* ========================== KUVA ========================== */

kuva = new Image();
kuva.decoding = 'async';
kuva.onload = () => { kuvaValmis = true; sovitaNaytolle(); piirra(); };
kuva.onerror = () => naytaViesti('Karttakuvaa ei löytynyt. Tarkista, että ' +
  KARTTA.tiedosto + ' on samassa kansiossa.', true);
kuva.src = KARTTA.tiedosto;

function sovitaNaytolle() {
  const w = cv.clientWidth, h = cv.clientHeight;
  const s = Math.min(w / KARTTA.leveys, h / KARTTA.korkeus);
  minSkaala = s * 0.6;
  skaala = s;
  tx = (w - KARTTA.leveys * s) / 2;
  ty = (h - KARTTA.korkeus * s) / 2;
}

/* ========================== PIIRTO ========================== */

function pyydaPiirto() {
  if (piirtoPyynto) return;
  piirtoPyynto = requestAnimationFrame(() => { piirtoPyynto = null; piirra(); });
}

function piirra() {
  const w = cv.clientWidth, h = cv.clientHeight, r = dpr();
  if (cv.width !== Math.round(w * r) || cv.height !== Math.round(h * r)) {
    cv.width = Math.round(w * r); cv.height = Math.round(h * r);
  }
  ctx.setTransform(r, 0, 0, r, 0, 0);
  ctx.clearRect(0, 0, w, h);

  if (kuvaValmis) {
    ctx.save();
    ctx.translate(tx, ty);
    ctx.scale(skaala, skaala);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(kuva, 0, 0);
    ctx.restore();
  }

  if (sijainti) {
    const sx = tx + sijainti.x * skaala;
    const sy = ty + sijainti.y * skaala;
    const kartalla = sijainti.x >= 0 && sijainti.x <= KARTTA.leveys &&
                     sijainti.y >= 0 && sijainti.y <= KARTTA.korkeus;
    if (kartalla) piirraMerkki(sx, sy);
    else piirraNuoliReunalle(sx, sy, w, h);
  }
  paivitaJana();
}

/* Mittausmerkki: kaksoisreunus, joka erottuu kartan kaikilta väreiltä. */
function piirraMerkki(x, y) {
  // tarkkuussäde
  if (sijainti.tarkkuus > 0) {
    const rs = Math.max((sijainti.tarkkuus / mpp) * skaala, 16);
    ctx.beginPath(); ctx.arc(x, y, rs, 0, 7);
    ctx.fillStyle = 'rgba(234,238,230,.13)'; ctx.fill();
    ctx.setLineDash([5, 5]);
    ctx.strokeStyle = 'rgba(14,19,16,.75)'; ctx.lineWidth = 3.5; ctx.stroke();
    ctx.strokeStyle = 'rgba(234,238,230,.85)'; ctx.lineWidth = 1.4; ctx.stroke();
    ctx.setLineDash([]);
  }

  // suuntakiila (kartta on pohjoinen ylös, joten suunta 0 = ylös)
  const suunta = kompassiSuunta !== null ? kompassiSuunta : gpsSuunta;
  if (suunta !== null) {
    const a = (suunta - 90) * Math.PI / 180, k = 24 * Math.PI / 180, pit = 54;
    ctx.save(); ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.arc(x, y, pit, a - k, a + k);
    ctx.closePath();
    const g = ctx.createRadialGradient(x, y, 8, x, y, pit);
    g.addColorStop(0, 'rgba(234,238,230,.85)');
    g.addColorStop(1, 'rgba(234,238,230,0)');
    ctx.fillStyle = g; ctx.fill();
    ctx.strokeStyle = 'rgba(14,19,16,.5)'; ctx.lineWidth = 1; ctx.stroke();
    ctx.restore();
  }

  // rengas + ilmansuuntapiikit
  ctx.strokeStyle = 'rgba(14,19,16,.9)'; ctx.lineWidth = 6;
  ctx.beginPath(); ctx.arc(x, y, 12, 0, 7); ctx.stroke();
  ctx.strokeStyle = '#EAEEE6'; ctx.lineWidth = 2.6;
  ctx.beginPath(); ctx.arc(x, y, 12, 0, 7); ctx.stroke();

  for (let i = 0; i < 4; i++) {
    const a = i * Math.PI / 2;
    const c = Math.cos(a), s = Math.sin(a);
    ctx.strokeStyle = 'rgba(14,19,16,.9)'; ctx.lineWidth = 4.5;
    ctx.beginPath(); ctx.moveTo(x + c*13, y + s*13); ctx.lineTo(x + c*19, y + s*19); ctx.stroke();
    ctx.strokeStyle = '#EAEEE6'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(x + c*13, y + s*13); ctx.lineTo(x + c*19, y + s*19); ctx.stroke();
  }

  ctx.fillStyle = '#0E1310';
  ctx.beginPath(); ctx.arc(x, y, 4.6, 0, 7); ctx.fill();
  ctx.strokeStyle = '#EAEEE6'; ctx.lineWidth = 1.6; ctx.stroke();
}

function piirraNuoliReunalle(sx, sy, w, h) {
  const kx = rajaa(sx, 40, w - 40), ky = rajaa(sy, 100, h - 100);
  const a = Math.atan2(sy - ky, sx - kx);
  ctx.save(); ctx.translate(kx, ky); ctx.rotate(a);
  ctx.beginPath(); ctx.moveTo(16, 0); ctx.lineTo(-9, 9); ctx.lineTo(-9, -9); ctx.closePath();
  ctx.fillStyle = '#E8A87C'; ctx.fill();
  ctx.strokeStyle = 'rgba(14,19,16,.9)'; ctx.lineWidth = 2; ctx.stroke();
  ctx.restore();
}

function paivitaJana() {
  const vaihtoehdot = [5, 10, 20, 25, 50, 100, 200, 250, 500, 1000];
  let valittu = vaihtoehdot[0];
  for (const d of vaihtoehdot) {
    const lev = (d / mpp) * skaala;
    if (lev >= 60 && lev <= 150) { valittu = d; break; }
    if (lev < 60) valittu = d;
  }
  el.jana.style.width = Math.round((valittu / mpp) * skaala) + 'px';
  el.janat.textContent = valittu + ' m';
}

/* ========================== ELEET ========================== */

const osoittimet = new Map();

function keskipiste() {
  let x = 0, y = 0;
  for (const p of osoittimet.values()) { x += p.x; y += p.y; }
  const n = osoittimet.size || 1;
  return { x: x / n, y: y / n };
}
function hajonta() {
  if (osoittimet.size < 2) return 0;
  const a = [...osoittimet.values()];
  return Math.hypot(a[0].x - a[1].x, a[0].y - a[1].y);
}

cv.addEventListener('pointerdown', e => {
  cv.setPointerCapture(e.pointerId);
  osoittimet.set(e.pointerId, { x: e.clientX, y: e.clientY });
});

cv.addEventListener('pointermove', e => {
  if (!osoittimet.has(e.pointerId)) return;
  const kPrev = keskipiste(), hPrev = hajonta();
  osoittimet.set(e.pointerId, { x: e.clientX, y: e.clientY });
  const kUusi = keskipiste(), hUusi = hajonta();

  if (hPrev > 0 && hUusi > 0) {
    const uusiS = rajaa(skaala * (hUusi / hPrev), minSkaala, maxSkaala);
    const suhde = uusiS / skaala;
    tx = kUusi.x - (kPrev.x - tx) * suhde;
    ty = kUusi.y - (kPrev.y - ty) * suhde;
    skaala = uusiS;
  } else {
    tx += kUusi.x - kPrev.x;
    ty += kUusi.y - kPrev.y;
  }
  asetaSeuraa(false);
  pyydaPiirto();
});

['pointerup', 'pointercancel'].forEach(t =>
  cv.addEventListener(t, e => osoittimet.delete(e.pointerId)));

cv.addEventListener('wheel', e => {
  e.preventDefault();
  zoomaa(Math.exp(-e.deltaY * 0.0015), e.clientX, e.clientY);
}, { passive: false });

function zoomaa(kerroin, kx, ky) {
  const uusiS = rajaa(skaala * kerroin, minSkaala, maxSkaala);
  const suhde = uusiS / skaala;
  if (kx === undefined) { kx = cv.clientWidth / 2; ky = cv.clientHeight / 2; }
  tx = kx - (kx - tx) * suhde;
  ty = ky - (ky - ty) * suhde;
  skaala = uusiS;
  pyydaPiirto();
}

function asetaSeuraa(paalla) {
  seuraa = paalla;
  el.seuraa.classList.toggle('paalla', paalla);
  if (paalla) keskita();
}

function keskita() {
  if (!sijainti) return;
  tx = cv.clientWidth / 2 - sijainti.x * skaala;
  ty = cv.clientHeight / 2 - sijainti.y * skaala;
  pyydaPiirto();
}

el.seuraa.addEventListener('click', () => asetaSeuraa(!seuraa));
document.getElementById('nappi-lahemmas').addEventListener('click', () => zoomaa(1.6));
document.getElementById('nappi-kauemmas').addEventListener('click', () => zoomaa(1 / 1.6));
window.addEventListener('resize', () => { if (seuraa) keskita(); pyydaPiirto(); });

/* ========================== PAIKANNUS ========================== */

const SUUNNAT = ['pohjoiseen','koilliseen','itään','kaakkoon',
                 'etelään','lounaaseen','länteen','luoteeseen'];

function naytaViesti(teksti, pysyva) {
  el.viesti.textContent = teksti;
  el.viesti.classList.add('nakyy');
  clearTimeout(naytaViesti.ajastin);
  if (!pysyva) naytaViesti.ajastin = setTimeout(piilotaViesti, 6000);
}
function piilotaViesti() { el.viesti.classList.remove('nakyy'); }

if (!('geolocation' in navigator)) {
  naytaViesti('Selain ei tue paikannusta.', true);
} else {
  navigator.geolocation.watchPosition(onSijainti, onVirhe, {
    enableHighAccuracy: true, maximumAge: 0, timeout: 25000
  });
}

function onSijainti(pos) {
  const c = pos.coords;
  const tm = wgsTm35(c.latitude, c.longitude);
  const p = tmPikseliksi(tm.E, tm.N);
  sijainti = { x: p.x, y: p.y, E: tm.E, N: tm.N, tarkkuus: c.accuracy || 0 };

  gpsSuunta = (c.heading !== null && !isNaN(c.heading) && c.speed > 0.7) ? c.heading : gpsSuunta;

  el.koord.innerHTML = 'N ' + tm.N.toFixed(0) + '  E ' + tm.E.toFixed(0) +
                       '<span id="syke"></span>';
  el.syke = document.getElementById('syke');
  el.syke.classList.add('osuma');
  setTimeout(() => el.syke && el.syke.classList.remove('osuma'), 900);

  el.tarkkuus.textContent = Math.round(c.accuracy) + ' m';
  el.tarkkuus.classList.toggle('karkea', c.accuracy > 25);

  const ulkona = p.x < 0 || p.x > KARTTA.leveys || p.y < 0 || p.y > KARTTA.korkeus;
  if (ulkona) {
    const kx = rajaa(p.x, 0, KARTTA.leveys), ky = rajaa(p.y, 0, KARTTA.korkeus);
    const dE = (kx - p.x) * mppX, dN = -(ky - p.y) * mppY;
    const matka = Math.hypot(dE, dN);
    let sd = Math.atan2(dE, dN) * 180 / Math.PI; if (sd < 0) sd += 360;
    naytaViesti('Olet kartan ulkopuolella. Kartta alkaa ' +
      Math.round(matka) + ' m ' + SUUNNAT[Math.round(sd / 45) % 8] + '.', true);
  } else {
    piilotaViesti();
  }

  if (seuraa) keskita(); else pyydaPiirto();
}

function onVirhe(e) {
  if (e.code === 1) naytaViesti('Paikannus estetty. Salli sijainti asetuksista: ' +
    'Asetukset › Safari › Sijainti.', true);
  else if (e.code === 3) naytaViesti('Paikannus ei vastaa. Odota hetki avoimemmassa maastossa.');
  else naytaViesti('Paikannus epäonnistui.');
}

/* ========================== KOMPASSI ========================== */

if (window.DeviceOrientationEvent) el.kompassi.hidden = false;

el.kompassi.addEventListener('click', async () => {
  if (kompassiSuunta !== null) {   // pois päältä
    kompassiSuunta = null;
    el.kompassi.classList.remove('paalla');
    pyydaPiirto();
    return;
  }
  try {
    if (typeof DeviceOrientationEvent.requestPermission === 'function') {
      const lupa = await DeviceOrientationEvent.requestPermission();
      if (lupa !== 'granted') { naytaViesti('Kompassilupa evätty.'); return; }
    }
    window.addEventListener('deviceorientation', onSuunta, true);
    window.addEventListener('deviceorientationabsolute', onSuunta, true);
    el.kompassi.classList.add('paalla');
  } catch (err) {
    naytaViesti('Kompassia ei saatu käyttöön.');
  }
});

function onSuunta(e) {
  let s = null;
  if (typeof e.webkitCompassHeading === 'number') s = e.webkitCompassHeading;
  else if (e.absolute && typeof e.alpha === 'number') s = 360 - e.alpha;
  if (s === null || isNaN(s)) return;
  kompassiSuunta = s;
  pyydaPiirto();
}

/* ===================== NÄYTTÖ HEREILLÄ ===================== */

let lukko = null;
async function pyydaLukko() {
  if (!('wakeLock' in navigator)) return;
  try { lukko = await navigator.wakeLock.request('screen'); } catch (e) {}
}
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') pyydaLukko();
});
document.addEventListener('pointerdown', function eka() {
  pyydaLukko();
  document.removeEventListener('pointerdown', eka);
});

/* ===================== SERVICE WORKER ===================== */

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('sw.js'));
}

piirra();