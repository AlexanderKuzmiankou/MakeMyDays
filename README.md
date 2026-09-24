# MakeMyDays

**Live:** [makemydays.cc](https://makemydays.cc)

> A personal assistant and tracking system with a purpose to help you make your day easier and more organized.

MakeMyDays is a self-hosted web-app which is used as a personal assistant and organizer. It covers multiple areas of your life and ensures an easy and intuitive tracking of your tasks, calendars, budget, etc. 
It can read your Google Calendar entries and the tasks from it, track your habits, organize your budget, keep track of your spendings and your shopping lists.
Built from scratch. Touching cloud infrastructure, containers, CI/CD, Kubernetes and monitoring. AI features to be added.

---

## What it does

1. WebApp (mobile app in the future) as a central hub
2. Tracking of calendars and tasks
3. Tracking of habits
4. Shopping lists
5. Budgeting assistant
6. Shared costs tracker
7. Notes

The goal of this project is to create a web dashboard to improve tracking of various parts of life all in one app.

---

## Architecture

```
Browser → Cloudflare Tunnel → Raspberry Pi 3B+
                                    │
                    ┌───────────────┼───────────────┐
                    │               │               │
               FastAPI app     Prometheus      Grafana
                    │               │               │
              Google Calendar   node-exporter   Dashboards
              Anthropic Claude
              AWS Polly
              AWS SSM
```

---

## Tech stack

| Layer | Technology |
|---|---|
| Language | Python 3.12 |
| Web framework | FastAPI |
| AI | Anthropic Claude API |
| Calendar | Google Calendar API |
| Messaging | Telegram Bot API |
| TTS | AWS Polly (Phase 5) |
| Container | Docker |
| Cloud | AWS (EC2 → EKS) [Replaced with a Raspberry Pi 3B+ during development]|
| IaC | Terraform |
| CI/CD | GitHub Actions |
| Orchestration | Kubernetes [Currently not on raspberry because of limited resources] |
| Monitoring | Grafana & Prometheus |

---

## Project structure

```
Check Project in this Repo
```

---

### Prerequisites

- Python 3.12+
- A Google Cloud project with Calendar API enabled

### Local setup

```bash
git clone https://github.com/HighstoneWallace/make_my_day.git
cd make_my_day

python -m venv venv
source venv/bin/activate
pip install -r requirements.txt

cp .env.example .env

python app/main.py
```
---

## Why this project exists

I'm a DevOps engineer with a systems engineering background. This project is designed to touch every layer of a real production system: from a Python script all the way to Kubernetes and monitoring, while building something I'll actually use every day and expanding my knowledge and experience.

---

## Key Engineering Decisions

- **Raspberry Pi over EC2** -> migrated from AWS EC2 to a self-hosted Pi 
  to eliminate ongoing cloud costs during development phase
- **Cloudflare Tunnel** -> provides public HTTPS access without port 
  forwarding or a static IP, with free SSL termination
- **SSM Parameter Store** -> all secrets managed in AWS SSM, never stored 
  on disk or in environment files
- **Multi-platform Docker builds** -> images built for both amd64 and arm64 
  so the same ECR image runs on both CI runners and the Pi

## License
MIT
