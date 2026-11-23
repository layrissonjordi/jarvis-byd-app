/* App do celular (PWA) do Jarvis BYD — lê a telemetria do carro por MQTT e mostra o painel.
   A lógica pura (parse/formatação/view) fica em funções testáveis, exportadas para o Node. */

(function (root) {
  "use strict";

  // ---- Lógica pura (testável sem navegador nem broker) ----
  function parseTelemetry(payload) {
    const t = typeof payload === "string" ? JSON.parse(payload) : payload;
    return {
      v: t.v ?? 1,
      ts: t.ts ?? 0,
      bateria: t.bateria ?? null,
      autonomiaKm: t.autonomia_km ?? null,
      carregando: t.carregando ?? null,
      ar: t.ar ?? null,
      tempAlvo: t.temp_alvo ?? null,
      portas: t.portas ?? null,
      janelas: t.janelas ?? null,
      tempExterna: t.temp_externa ?? null,
      ventilador: t.ventilador ?? null,
      odometroKm: t.odometro_km ?? null,
    };
  }

  function viewModel(t) {
    return {
      bateria: t.bateria == null ? "—" : String(t.bateria),
      batPct: t.bateria == null ? 0 : Math.max(0, Math.min(100, t.bateria)),
      autonomia: t.autonomiaKm == null ? "—" : String(t.autonomiaKm),
      carregando: t.carregando ? "⚡ carregando · " : "",
      ar: t.ar == null ? "—" : t.ar ? "Ligado" : "Desligado",
      temp: t.tempAlvo == null ? "" : t.tempAlvo + " °C",
      portas: t.portas ?? "—",
      portasAlerta: t.portas === "destrancadas",
      janelas: t.janelas ?? "—",
      fora: t.tempExterna == null ? "—" : t.tempExterna + " °C",
      ventilador: t.ventilador == null ? "—" : String(t.ventilador),
      odometro: t.odometroKm == null ? "" : t.odometroKm.toLocaleString("pt-BR") + " km",
      quando: t.ts ? new Date(t.ts).toLocaleTimeString("pt-BR") : "—",
    };
  }

  function wsUrl(host, port) {
    return `wss://${host}:${port}/mqtt`;   // WebSocket seguro em /mqtt (EMQX e HiveMQ)
  }

  /** Aceita o endereço colado do painel ("mqtts://host:8883", "host:8084/mqtt"...) e devolve só o host. */
  function limparHost(h) {
    return String(h).trim().replace(/^[a-z]+:\/\//i, "").replace(/[:/].*$/, "");
  }

  function portaPadrao(host) { return /hivemq/i.test(host) ? "8884" : "8084"; }   // EMQX usa 8084

  function parseTrip(payload) {
    const t = typeof payload === "string" ? JSON.parse(payload) : payload;
    return {
      distanciaKm: t.distancia_km ?? 0,
      consumoKwh100: t.consumo_kwh_100 ?? 0,
      consumoKwh: t.consumo_kwh ?? 0,
      bateriaInicio: t.bateria_inicio ?? null,
      bateriaFim: t.bateria_fim ?? null,
      duracaoS: t.duracao_s ?? 0,
      fimTs: t.fim_ts ?? 0,
    };
  }

  function tripView(t) {
    const bat = t.bateriaInicio == null ? "" : `${t.bateriaInicio}%→${t.bateriaFim}%`;
    return {
      km: `${t.distanciaKm} km`,
      ef: `${t.consumoKwh100} kWh/100km`,
      bat,
      min: Math.round(t.duracaoS / 60) + " min",
    };
  }

  function alertText(payload) {
    const a = typeof payload === "string" ? JSON.parse(payload) : payload;
    return a.texto || a.tipo || "Alerta";
  }

  // ---- Comandos do ar (lógica pura) ----
  const TEMP_MIN = 17, TEMP_MAX = 33;

  /** Comando para o carro. O carro ignora o que tiver mais de 30 s ou id repetido. */
  function novoComando(nome, args, agora, id) {
    return JSON.stringify({ id: id || newSessionId(), nome, args, ts: agora });
  }

  /** Próximo comando a partir do estado atual e do botão; null = não dá (sem leitura ou no limite). */
  function comandoDoBotao(botao, t) {
    if (!t) return null;
    const passo = (v, d, min, max) => (v == null || v + d < min || v + d > max ? null : v + d);
    switch (botao) {
      case "ar": return t.ar == null ? null : { nome: "ligar_ar", args: { ligado: !t.ar } };
      case "temp-": case "temp+": {
        const g = passo(t.tempAlvo, botao === "temp+" ? 1 : -1, TEMP_MIN, TEMP_MAX);
        return g == null ? null : { nome: "temperatura", args: { graus: g } };
      }
      case "vent-": case "vent+": {
        const n = passo(t.ventilador, botao === "vent+" ? 1 : -1, 1, 7);
        return n == null ? null : { nome: "ventilador", args: { nivel: n } };
      }
      case "desemb": return { nome: "desembacador", args: { qual: "dianteiro", ligado: true } };
      default: return null;
    }
  }

  function parseResposta(payload) {
    try {
      const r = JSON.parse(payload);
      return typeof r.id === "string" ? { id: r.id, ok: r.ok === true, motivo: typeof r.motivo === "string" ? r.motivo : "" } : null;
    } catch (e) { return null; }
  }

  // ---- Câmera ao vivo (lógica pura) ----
  const OFFER_TIMEOUT_MS = 20000;
  const KEEPALIVE_MS = 10000;

  function newSessionId() {
    const alfa = "abcdefghijklmnopqrstuvwxyz0123456789";
    const bytes = new Uint8Array(16);
    if (root.crypto && root.crypto.getRandomValues) root.crypto.getRandomValues(bytes);
    else for (let i = 0; i < 16; i++) bytes[i] = Math.floor(Math.random() * 256);
    let id = "";
    for (const b of bytes) id += alfa[b % alfa.length];
    return id;
  }

  function parseVideoState(payload) {
    try {
      const v = typeof payload === "string" ? JSON.parse(payload) : payload;
      if (!v || typeof v !== "object") return null;
      return {
        cameras: Array.isArray(v.cameras) ? v.cameras : [],
        podeTransmitir: v.podeTransmitir === true,
        motivo: v.motivo ?? null,
      };
    } catch (e) { return null; }
  }

  function parseSignal(payload) {
    try {
      const s = typeof payload === "string" ? JSON.parse(payload) : payload;
      if (!s || typeof s !== "object" || s.de !== "carro" || typeof s.tipo !== "string") return null;
      return s;
    } catch (e) { return null; }
  }

  function cameraButton(online, state) {
    if (!online) return { enabled: false, motivo: "carro offline" };
    if (!state) return { enabled: false, motivo: "aguardando o carro" };
    if (!state.podeTransmitir) return { enabled: false, motivo: state.motivo || "carro indisponível" };
    if (!state.cameras.length) return { enabled: false, motivo: "nenhuma câmera encontrada" };
    return { enabled: true, motivo: null };
  }

  function connectionLabel(relay) {
    if (relay === true) return "via retransmissão";
    if (relay === false) return "direta";
    return "…";
  }

  // Texto de status sem sessão ativa: junta o último motivo de parada com o motivo atual do botão desabilitado.
  function idleStatus(button, lastStop) {
    if (button.enabled) return lastStop || "pronto";
    return lastStop ? `${lastStop} · ${button.motivo}` : button.motivo;
  }

  // Keepalive vai com QoS 1 (perder um derruba a sessão no carro); o resto do sinal, QoS 0.
  function signalQos(tipo) { return tipo === "keepalive" ? 1 : 0; }

  function offerTimedOut(startedAt, now) { return now - startedAt > OFFER_TIMEOUT_MS; }

  function stopReasonText(reason) {
    const m = {
      NOT_PARKED: "o carro saiu do P",
      FACTORY_CAMERA: "a câmera de fábrica (ré/360°) foi acionada",
      HANG_UP: "transmissão encerrada",
      KEEPALIVE_TIMEOUT: "sem sinal do celular",
      PEER_LOST: "conexão perdida",
      REPLACED: "outro celular assumiu a transmissão",
    };
    return m[reason] || "transmissão encerrada";
  }

  const logic = { limparHost, portaPadrao, parseTelemetry, viewModel, wsUrl, parseTrip, tripView, alertText,
    newSessionId, parseVideoState, parseSignal, cameraButton, connectionLabel, offerTimedOut, stopReasonText, idleStatus, signalQos, novoComando, comandoDoBotao, parseResposta };

  // Em Node (testes): exporta e para. No navegador: segue para a UI.
  if (typeof module !== "undefined" && module.exports) { module.exports = logic; return; }

  // ---- UI (navegador) ----
  const $ = (id) => document.getElementById(id);
  const STORE = "jarvisbyd.conn";
  let client = null;

  function setStatus(state, text) {
    $("dot").className = "dot " + (state || "");
    $("statusText").textContent = text;
  }

  const trips = [];
  function addTrip(t) {
    trips.unshift(t);
    if (trips.length > 10) trips.pop();
    const ul = $("viagens");
    ul.innerHTML = "";
    for (const tr of trips) {
      const v = tripView(tr);
      const li = document.createElement("li");
      const left = document.createElement("span");
      left.className = "km"; left.textContent = v.km;
      const right = document.createElement("span");
      right.className = "eff"; right.textContent = `${v.ef} · ${v.bat}`;
      li.append(left, right);
      ul.appendChild(li);
    }
  }

  function toast(text, isAlert) {
    const el = document.createElement("div");
    el.className = "toast" + (isAlert ? " alert" : "");
    el.textContent = text;
    $("toasts").appendChild(el);
    setTimeout(() => el.remove(), 5000);
  }

  function render(t) {
    const m = viewModel(t);
    $("bateria").textContent = m.bateria;
    $("batBar").style.width = m.batPct + "%";
    $("autonomia").textContent = m.autonomia;
    $("carregando").textContent = m.carregando;
    $("arVal").textContent = m.ar;
    $("temp").textContent = m.temp;
    $("portas").textContent = m.portas;
    $("portas").className = "pill" + (m.portasAlerta ? " alert" : "");
    $("janelas").textContent = m.janelas;
    $("fora").textContent = m.fora;
    $("vent").textContent = m.ventilador;
    $("odometro").textContent = m.odometro;
    $("quando").textContent = m.quando;
  }

  // ---- Câmera ao vivo (UI + WebRTC; o carro faz a oferta, o celular responde) ----
  let carOnline = false;
  let videoState = null;
  let base = "";
  let lastStopMsg = null;   // motivo da última parada; só some quando o usuário inicia outra sessão
  let cam = null;      // sessão ativa: {id, pc, startedAt, queue, timers..., relay}

  const mmss = (s) => Math.floor(s / 60) + ":" + String(s % 60).padStart(2, "0");
  const pubSinal = (sig) => {
    if (client && cam) client.publish(`${base}/video/sinal/${cam.id}`, JSON.stringify({ de: "celular", ...sig }), { qos: signalQos(sig.tipo) });
  };

  function camStatus(text, live) {
    $("camStatus").textContent = text;
    $("camLive").classList.toggle("hidden", !live);
  }

  function camRefresh() {
    const b = cameraButton(carOnline, videoState);
    const sel = $("camSel");
    const cams = videoState ? videoState.cameras : [];
    if (sel.options.length !== cams.length || cams.some((c, i) => sel.options[i].value !== c)) {
      const atual = sel.value;
      sel.innerHTML = "";
      for (const c of cams) { const o = document.createElement("option"); o.value = c; o.textContent = c; sel.appendChild(o); }
      if (cams.includes(atual)) sel.value = atual;
    }
    $("camStart").disabled = !b.enabled || !!cam;
    $("camStop").disabled = !cam;
    sel.disabled = !!cam || !cams.length;
    if (!cam) camStatus(idleStatus(b, lastStopMsg), false);
  }

  function camTeardown() {
    if (!cam) return;
    const c = cam; cam = null;
    clearTimeout(c.offerTimer); clearInterval(c.keepTimer); clearInterval(c.tickTimer); clearInterval(c.statsTimer);
    if (c.pc) { try { c.pc.close(); } catch (e) { /* já fechado */ } }
    try { client.unsubscribe(`${base}/video/sinal/${c.id}`); } catch (e) { /* sem conexão */ }
    $("camVideo").srcObject = null;
    $("camInfo").textContent = "";
  }

  // Encerra a sessão; avisa o carro (encerrar) e mostra o motivo, se houver.
  function camStop(avisarCarro, motivo) {
    if (!cam) return;
    if (avisarCarro && client) client.publish(`${base}/video/pedido`, JSON.stringify({ sessao: cam.id, encerrar: true }), { qos: 1 });
    camTeardown();
    camRefresh();
    if (motivo) { lastStopMsg = motivo; camStatus(motivo, false); }
  }

  function camStart() {
    if (cam || !client) return;
    const camera = $("camSel").value;
    if (!camera) return;
    lastStopMsg = null;
    const id = newSessionId();
    cam = { id, pc: null, startedAt: Date.now(), queue: [], relay: null };
    client.subscribe(`${base}/video/sinal/${id}`, { qos: 0 });
    client.publish(`${base}/video/pedido`, JSON.stringify({ sessao: id, camera }), { qos: 1 });
    pubSinal({ tipo: "keepalive" });   // já conta para o prazo de 30 s do carro
    cam.offerTimer = setTimeout(() => {
      if (cam && cam.id === id && !cam.pc && offerTimedOut(cam.startedAt, Date.now())) camStop(true, "o carro não respondeu");
    }, OFFER_TIMEOUT_MS + 500);
    camRefresh();
    camStatus("aguardando o carro…", false);
  }

  async function camOnOffer(sig) {
    const c = cam;
    if (c.pc || !sig.sdp) return;
    clearTimeout(c.offerTimer);
    const pc = new RTCPeerConnection({ iceServers: Array.isArray(sig.iceServers) ? sig.iceServers : [] });
    c.pc = pc;
    pc.onicecandidate = (ev) => {
      if (ev.candidate) pubSinal({ tipo: "ice", candidate: ev.candidate.candidate,
        sdpMid: ev.candidate.sdpMid, sdpMLineIndex: ev.candidate.sdpMLineIndex });
    };
    pc.ontrack = (ev) => {
      const v = $("camVideo");
      v.srcObject = ev.streams[0] || new MediaStream([ev.track]);
      const p = v.play(); if (p && p.catch) p.catch(() => {});   // iOS: ignora o play rejeitado
    };
    pc.onconnectionstatechange = () => {
      if (cam !== c) return;
      if (pc.connectionState === "connected") camStatus("ao vivo", true);
      else if (pc.connectionState === "failed" || pc.connectionState === "closed") camStop(true, "conexão perdida");
    };
    try {
      await pc.setRemoteDescription({ type: "offer", sdp: sig.sdp });
      for (const q of c.queue.splice(0)) await pc.addIceCandidate(q).catch(() => {});
      const ans = await pc.createAnswer();
      await pc.setLocalDescription(ans);
      if (cam !== c) return;
      pubSinal({ tipo: "resposta", sdp: ans.sdp });
      camStatus("conectando…", false);
      pubSinal({ tipo: "keepalive" });   // um logo após a resposta, depois a cada 10 s
      c.keepTimer = setInterval(() => pubSinal({ tipo: "keepalive" }), KEEPALIVE_MS);
      c.tickTimer = setInterval(() => {
        $("camInfo").textContent = `conexão: ${connectionLabel(c.relay)} · ${mmss(Math.floor((Date.now() - c.startedAt) / 1000))}`;
      }, 1000);
      c.statsTimer = setInterval(() => camStats(c), 3000);
    } catch (e) { console.error("falha na conexão WebRTC:", e && e.name); camStop(true, "falha ao conectar"); }
  }

  async function camStats(c) {
    try {
      const rep = await c.pc.getStats();
      let pair = null;
      rep.forEach((r) => { if (r.type === "transport" && r.selectedCandidatePairId) pair = rep.get(r.selectedCandidatePairId); });
      if (!pair) rep.forEach((r) => { if (r.type === "candidate-pair" && r.nominated && r.state === "succeeded") pair = r; });
      if (!pair) return;
      const l = rep.get(pair.localCandidateId), r = rep.get(pair.remoteCandidateId);
      c.relay = (l && l.candidateType === "relay") || (r && r.candidateType === "relay") || false;
    } catch (e) { /* stats indisponíveis */ }
  }

  function camOnSignal(topic, s) {
    if (!cam || !topic.endsWith("/video/sinal/" + cam.id)) return;
    const sig = parseSignal(s);
    if (!sig) return;
    if (sig.tipo === "oferta") camOnOffer(sig);
    else if (sig.tipo === "ice" && sig.candidate) {
      const cand = { candidate: sig.candidate, sdpMid: sig.sdpMid, sdpMLineIndex: sig.sdpMLineIndex };
      if (cam.pc && cam.pc.remoteDescription) cam.pc.addIceCandidate(cand).catch(() => {});
      else cam.queue.push(cand);     // o carro pode mandar ICE antes da oferta chegar
    } else if (sig.tipo === "fim") camStop(false, "transmissão encerrada: " + stopReasonText(sig.sdp));
  }

  $("camStart").addEventListener("click", camStart);
  $("camStop").addEventListener("click", () => camStop(true, "encerrado"));
  document.addEventListener("visibilitychange", () => { if (document.hidden) camStop(true, "encerrado ao minimizar"); });
  root.addEventListener("pagehide", () => camStop(true));

  // ---- Ar-condicionado a distância ----
  let ultima = null, pendente = null, pendenteTimer = null;

  function climaRefresh() {
    for (const b of document.querySelectorAll("[data-clima]"))
      b.disabled = !carOnline || !!pendente || !comandoDoBotao(b.dataset.clima, ultima);
    $("arBotao").textContent = ultima && ultima.ar ? "Desligar ar" : "Ligar ar";
    if (!pendente && !carOnline) $("climaStatus").textContent = "carro offline";
    else if (!pendente && $("climaStatus").textContent === "carro offline") $("climaStatus").textContent = "";
  }

  function climaMandar(botao) {
    const c = comandoDoBotao(botao, ultima);
    if (!client || !carOnline || pendente || !c) return;
    pendente = newSessionId();
    client.publish(base + "/comando", novoComando(c.nome, c.args, Date.now(), pendente), { qos: 1, retain: false });
    $("climaStatus").textContent = "enviando…";
    pendenteTimer = setTimeout(() => climaFim("o carro não respondeu"), 8000);
    climaRefresh();
  }

  function climaResposta(r) {
    if (!r || r.id !== pendente) return;
    climaFim(r.ok ? "pronto" : "não deu: " + (r.motivo || "recusado"));
  }

  function climaFim(texto) {
    clearTimeout(pendenteTimer);
    pendente = null;
    $("climaStatus").textContent = texto;
    climaRefresh();
  }

  for (const b of document.querySelectorAll("[data-clima]")) b.addEventListener("click", () => climaMandar(b.dataset.clima));

  function conectar(cfg) {
    base = `jarvisbyd/${cfg.car}`;
    setStatus("", "conectando…");
    client = mqtt.connect(wsUrl(cfg.host, cfg.port), {
      username: cfg.user, password: cfg.pass,
      clientId: "jarvis-phone-" + Math.random().toString(16).slice(2, 8),
      clean: true, reconnectPeriod: 3000, connectTimeout: 15000,
    });
    client.on("connect", () => {
      setStatus("online", "conectado");
      client.subscribe([base + "/telemetria", base + "/status", base + "/viagem", base + "/alerta", base + "/comando/resposta", base + "/video/estado"], { qos: 1 });
      $("setup").classList.add("hidden");
      $("dash").classList.remove("hidden");
    });
    client.on("message", (topic, buf) => {
      const s = buf.toString();
      try {
        if (topic.endsWith("/status")) {
          const on = s === "online";
          setStatus(on ? "online" : "offline", on ? "carro online" : "carro offline");
          carOnline = on;
          climaRefresh();
          if (!on) camStop(false, "carro offline");
          camRefresh();
        } else if (topic.endsWith("/video/estado")) {
          videoState = parseVideoState(s);
          camRefresh();
        } else if (topic.includes("/video/sinal/")) {
          camOnSignal(topic, s);
        } else if (topic.endsWith("/telemetria")) {
          ultima = parseTelemetry(s);
          render(ultima);
          climaRefresh();
        } else if (topic.endsWith("/comando/resposta")) {
          climaResposta(parseResposta(s));
        } else if (topic.endsWith("/viagem")) {
          addTrip(parseTrip(s));
        } else if (topic.endsWith("/alerta")) {
          toast(alertText(s), true);
        }
      } catch (e) { console.error(e); }
    });
    client.on("error", (e) => setStatus("offline", "erro: " + e.message));
    client.on("reconnect", () => setStatus("", "reconectando…"));
    client.on("close", () => { setStatus("offline", "desconectado"); carOnline = false; camStop(false, "desconectado"); camRefresh(); });
  }

  $("setup").addEventListener("submit", (ev) => {
    ev.preventDefault();
    const host = limparHost($("host").value);
    const cfg = { host, port: ($("port").value.trim() || portaPadrao(host)),
      user: $("user").value.trim(), pass: $("pass").value, car: ($("car").value.trim() || "demo") };
    if (!cfg.host || !cfg.user) return;
    localStorage.setItem(STORE, JSON.stringify(cfg));
    conectar(cfg);
  });

  $("trocar").addEventListener("click", (ev) => {
    ev.preventDefault();
    if (client) client.end(true);
    $("dash").classList.add("hidden");
    $("setup").classList.remove("hidden");
  });

  $("limpar").addEventListener("click", () => { localStorage.removeItem(STORE); location.reload(); });

  // Preenche o formulário com o que foi salvo e reconecta sozinho.
  const salvo = localStorage.getItem(STORE);
  if (salvo) {
    try {
      const cfg = JSON.parse(salvo);
      $("host").value = cfg.host || ""; $("port").value = cfg.port || "";
      $("user").value = cfg.user || ""; $("pass").value = cfg.pass || ""; $("car").value = cfg.car || "demo";
      if (cfg.host && cfg.user) conectar(cfg);
    } catch (e) { /* ignora config corrompida */ }
  }

  if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => {});
})(this);
