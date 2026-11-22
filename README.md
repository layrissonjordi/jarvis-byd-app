# Jarvis BYD — app do celular (PWA)

Painel do carro no celular, estilo Electro: mostra bateria, autonomia, clima,
portas e janelas **ao vivo**, de qualquer lugar. É uma PWA — abre no navegador do
celular e pode ser "instalada" na tela inicial, sem loja de apps.

Lê a telemetria por **MQTT sobre WebSocket seguro (wss)**. O app do carro (ou o
demo do PC) publica; este app assina e mostra.

## 1. Criar um broker grátis (HiveMQ Cloud)

O "ponto de encontro" entre o carro e o celular. Grátis até 100 conexões.

1. Crie uma conta em **console.hivemq.cloud** e crie um **cluster** (plano Free).
2. Em **Access Management → Credentials**, crie um usuário e senha.
3. Anote do painel do cluster:
   - **Host** (algo como `abc123.s1.eu.hivemq.cloud`)
   - Porta **8883** (TLS, usada pelo carro/demo) e **8884** (WebSocket, usada por este app).

## 2. Publicar a telemetria (demo do PC, para testar sem o carro)

No `demo/config.json`, preencha o bloco `mqtt`:

```json
"mqtt": { "host": "abc123.s1.eu.hivemq.cloud", "port": 8883,
          "user": "SEU_USUARIO", "pass": "SUA_SENHA", "car_id": "demo" }
```

Rode o demo e dê comandos ("liga o ar", "coloca 19 graus"): ele publica a cada mudança.

## 3. Abrir o app do celular

Sirva esta pasta por HTTPS (a PWA e o `wss` exigem HTTPS) e abra no celular.
Opções fáceis:
- **GitHub Pages / Netlify / Cloudflare Pages:** suba a pasta `companion/`.
- Teste rápido no PC: `npx serve companion` e abra pelo navegador (local funciona em http).

Na tela inicial do app, informe **host**, **porta 8884**, **usuário**, **senha** e o
**car_id** (`demo`). Ele conecta e mostra o painel. Os dados ficam salvos no celular.

> Dica: dá pra pré-preencher tudo com um **QR Code** de pareamento (o app do carro
> mostra; o celular escaneia). Está no roteiro da Fase 1.

## Testes (lógica pura, sem navegador)

```powershell
node companion/app.test.js
```

## Arquivos
- `index.html` — a tela · `app.js` — conexão MQTT + painel (lógica testável separada)
- `manifest.webmanifest`, `sw.js`, `icon.svg` — o que faz virar PWA instalável
