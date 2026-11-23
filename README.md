# Jarvis BYD — app do celular (PWA)

Painel do carro no celular, estilo Electro: mostra bateria, autonomia, clima,
portas e janelas **ao vivo**, de qualquer lugar. É uma PWA — abre no navegador do
celular e pode ser "instalada" na tela inicial, sem loja de apps.

Lê a telemetria por **MQTT sobre WebSocket seguro (wss)**. O app do carro (ou o
demo do PC) publica; este app assina e mostra.

## 1. Criar um broker grátis (EMQX Serverless)

O "ponto de encontro" entre o carro e o celular. (O HiveMQ Serverless grátis fecha em 31/12/2026 e não aceita clusters novos.)

1. Crie uma conta em **cloud-intl.emqx.com/console**, **New Deployment → Serverless**, com **Spend Limit 0**.
2. Em **Access Control → Authentication → + Add**, crie um usuário e senha.
3. Anote da página **Overview**:
   - **Host** (algo como `abc123.ala.us-east-1.emqxsl.com`)
   - Porta **8883** (TLS, usada pelo carro/demo) e **8084** (WebSocket, usada por este app).

## 2. Publicar a telemetria (demo do PC, para testar sem o carro)

No `demo/config.json`, preencha o bloco `mqtt`:

```json
"mqtt": { "host": "abc123.ala.us-east-1.emqxsl.com", "port": 8883,
          "user": "SEU_USUARIO", "pass": "SUA_SENHA", "car_id": "demo" }
```

Rode o demo e dê comandos ("liga o ar", "coloca 19 graus"): ele publica a cada mudança.

## 3. Abrir o app do celular

Sirva esta pasta por HTTPS (a PWA e o `wss` exigem HTTPS) e abra no celular.
Opções fáceis:
- **GitHub Pages / Netlify / Cloudflare Pages:** suba a pasta `companion/`.
- Teste rápido no PC: `npx serve companion` e abra pelo navegador (local funciona em http).

Na tela inicial do app, informe **endereço** (a porta é automática), **usuário**, **senha** e o
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
