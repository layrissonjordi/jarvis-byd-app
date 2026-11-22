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
      quando: t.ts ? new Date(t.ts).toLocaleTimeString("pt-BR") : "—",
    };
  }

  function wsUrl(host, port) {
    return `wss://${host}:${port}/mqtt`;   // HiveMQ Cloud: WebSocket seguro em /mqtt
  }

  const logic = { parseTelemetry, viewModel, wsUrl };

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
    $("quando").textContent = m.quando;
  }

  function conectar(cfg) {
    const base = `jarvisbyd/${cfg.car}`;
    setStatus("", "conectando…");
    client = mqtt.connect(wsUrl(cfg.host, cfg.port), {
      username: cfg.user, password: cfg.pass,
      clientId: "jarvis-phone-" + Math.random().toString(16).slice(2, 8),
      clean: true, reconnectPeriod: 3000, connectTimeout: 15000,
    });
    client.on("connect", () => {
      setStatus("online", "conectado");
      client.subscribe([base + "/telemetria", base + "/status"], { qos: 1 });
      $("setup").classList.add("hidden");
      $("dash").classList.remove("hidden");
    });
    client.on("message", (topic, buf) => {
      if (topic.endsWith("/status")) {
        const on = buf.toString() === "online";
        setStatus(on ? "online" : "offline", on ? "carro online" : "carro offline");
      } else if (topic.endsWith("/telemetria")) {
        try { render(parseTelemetry(buf.toString())); } catch (e) { console.error(e); }
      }
    });
    client.on("error", (e) => setStatus("offline", "erro: " + e.message));
    client.on("reconnect", () => setStatus("", "reconectando…"));
    client.on("close", () => setStatus("offline", "desconectado"));
  }

  $("setup").addEventListener("submit", (ev) => {
    ev.preventDefault();
    const cfg = { host: $("host").value.trim(), port: ($("port").value.trim() || "8884"),
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
      $("host").value = cfg.host || ""; $("port").value = cfg.port || "8884";
      $("user").value = cfg.user || ""; $("pass").value = cfg.pass || ""; $("car").value = cfg.car || "demo";
      if (cfg.host && cfg.user) conectar(cfg);
    } catch (e) { /* ignora config corrompida */ }
  }

  if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => {});
})(this);
