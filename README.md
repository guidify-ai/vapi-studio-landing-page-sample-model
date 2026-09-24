# Vapi Studio — sample landing LLM

Public **showcase app** for [**@guidify-ai/vapi-studio**](https://www.npmjs.com/package/@guidify-ai/vapi-studio). This is not the framework — it **depends** on it, the same way your production bot should.

```bash
yarn add @guidify-ai/vapi-studio@0.1.0
```

| | |
| --- | --- |
| Port | **9998** |
| Operator UI | http://127.0.0.1:9998/flow · `/conversations` |
| Framework | [@guidify-ai/vapi-studio](https://github.com/guidify-ai/vapi-studio) |

## Run locally

Needs Docker + [ngrok](https://ngrok.com/download). Sibling layout for local framework builds:

```text
~/work/
  guidify-ai/                         # framework clone (or use npm only)
  vapi-studio-sample-landing-llm/     # this repo
```

```bash
cp .env.example .env   # set OPENAI_API_KEY if using ChatGPT Brain
yarn start             # Compose + ngrok; promotes docker-compose.stub.yaml once
```

Until `0.1.0` is on npm, point Docker at the sibling clone (`additional_contexts.vapi-studio` defaults to `../guidify-ai`) and for host installs:

```bash
# temporary local link while developing against an unpublished framework
yarn add file:../guidify-ai
```

After publish, pin the registry version again:

```bash
yarn add @guidify-ai/vapi-studio@0.1.0
```

## What this sample shows

- Nest wiring: `VapiStudioModule.forRoot`, Studio UI mount
- Planner-style `flow.yaml` + code intentions / nodes
- Vapi Custom LLM + webhook routes
- Event hooks (`src/shadows/`) without a durable event store in the framework

Northern stars only in this README — copy lives in nodes and `config/flow.yaml`.
