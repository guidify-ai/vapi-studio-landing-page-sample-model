# Vapi Studio — sample landing LLM

Showcase NestJS app for **[@guidify-ai/vapi-studio](https://www.npmjs.com/package/@guidify-ai/vapi-studio)**. Not the framework — it **depends** on it.

Voice demo script: `config/demo-conversation.yml` — project (exploring shares it) / docs question / issue / feature with consent-gated contact.

- **Project** — asks for the business, suggests 2–3 caller-assistant scenarios (`src/advisor/scenario-advisor.service.ts`), then asks consent for the team to follow up.
- **Docs question** — answers from the public repos [vapi-studio](https://github.com/guidify-ai/vapi-studio) and [vapi-studio-project](https://github.com/guidify-ai/vapi-studio-project) (`src/advisor/docs-advisor.service.ts`, optional `GITHUB_TOKEN`).
- **Issue** — collects the issue and one detail, emails it to `ISSUE_REPORT_TO` (falls back to `HOT_LEAD_TO`), then offers a follow-up.

| | |
| --- | --- |
| Port | **9998** |
| Operator UI | http://127.0.0.1:9998/flow · `/conversations` |
| Framework | [guidify-ai/vapi-studio](https://github.com/guidify-ai/vapi-studio) |
| This repo | [guidify-ai/vapi-studio-landing-page-sample-model](https://github.com/guidify-ai/vapi-studio-landing-page-sample-model) |
| Official team | Guidify AI can help build your solution — [framework README](https://github.com/guidify-ai/vapi-studio#need-the-official-team) |

## How it fits (platform)

```text
~/work/guidify-ai/
  Makefile
  vapi-studio/                        # framework (git + npm)
  vapi-studio-sample-landing-llm/     # this app
  vapi-studio-landing/                # marketing site → calls :9998
```

Day-to-day (spoof next Studio versions from local files):

```bash
cd ~/work/guidify-ai
make spoof-studio   # yarn build framework + sample dep = file:../vapi-studio
make start          # also landing + ngrok + Vapi keys
```

After publish, optionally:

```bash
make use-npm-studio   # sample dep = 0.1.0 from npm
```

## Run this app alone

```bash
cp .env.example .env
cd .. && make spoof-studio    # platform root = guidify-ai/
cd vapi-studio-sample-landing-llm && yarn start
```

Docker build context for the framework defaults to `../vapi-studio`.

## Tests

```bash
yarn -s build && node --test test/*.test.mjs
```

`test/landing-conversation.test.mjs` drives the real `config/flow.yaml` turn by turn with fake advisors and mail — no OpenAI, GitHub, or Resend traffic.
