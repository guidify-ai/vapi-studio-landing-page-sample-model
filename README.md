# Vapi Studio — sample landing LLM

Showcase NestJS app for **[@guidify-ai/vapi-studio](https://www.npmjs.com/package/@guidify-ai/vapi-studio)**. Not the framework — it **depends** on it.

| | |
| --- | --- |
| Port | **9998** |
| Operator UI | http://127.0.0.1:9998/flow · `/conversations` |
| Framework | [guidify-ai/vapi-studio](https://github.com/guidify-ai/vapi-studio) |
| This repo | [guidify-ai/vapi-studio-landing-page-sample-model](https://github.com/guidify-ai/vapi-studio-landing-page-sample-model) |

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
