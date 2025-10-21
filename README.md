# ReachInbox OneBox

ReachInbox OneBox is an end-to-end intelligent email workspace integrating IMAP real-time sync, AI-based categorization (via Gemini), Elasticsearch search, Qdrant vector storage for contextual reply suggestions, and Slack/webhook integrations for automated lead engagement.

# Table of Contents
1.Overview

2.Tech Stack

3.Architecture

4.Setup Instructions

5.Backend Setup

6.Docker (Data Layer Setup)

7.Frontend (React UI)

8.Environment Variables

9.Features Implemented

10.API Endpoints

11.Evaluation Criteria

12.Demo Instructions

# Overview

ReachInbox OneBox continually syncs incoming and outgoing emails across accounts in real-time using IMAP IDLE.
Incoming messages are indexed in Elasticsearch for search, categorized via Gemini LLM, and trigger external Slack/webhook notifications.
Additionally, a Retrieval-Augmented Generation (RAG) pipeline provides AI-suggested replies using a vector database (Qdrant) and contextual embeddings.

# Tech Stack

Backend: Node.js, TypeScript, Express, node-imap, @elastic/elasticsearch, Qdrant client, Gemini API
Frontend: React (CRA), Axios
Persistence: Elasticsearch, Qdrant
AI: Gemini API (Text & Embedding models)
Integrations: Slack Webhook, Webhook.site

# Setup Instructions
1. Clone Repository
bash
git clone https://github.com/<your-username>/reachinbox-onebox.git
cd reachinbox-onebox
2. Backend Setup
bash
# Initialize node project
npm install

# Install dependencies
npm install typescript @types/node ts-node express dotenv node-imap @elastic/elasticsearch qdrant-js winston cross-fetch

# Create environment file
touch .env
Start Backend:
bash
npm run dev
3. Docker Setup (Elasticsearch + Qdrant)
bash
docker-compose up -d
This launches:

Elasticsearch on port 9200

Qdrant on ports 6333 (REST) and 6334 (gRPC)

Verify with:

bash
curl http://localhost:9200
curl http://localhost:6333/healthz
4. Frontend Setup (React)
bash
cd frontend
npm install
npm start
API base URL inside App.js:

js
const API_BASE = "http://localhost:3000/api";
React runs on port 3001 by default.

Environment Variables
text
# General
PORT=3000
NODE_ENV=development

# IMAP configuration
IMAP_USER_1=user1@gmail.com
IMAP_PASS_1=app_password
IMAP_USER_2=user2@gmail.com
IMAP_PASS_2=app_password

# ElasticSearch
ELASTIC_URL=http://localhost:9200

# Qdrant
QDRANT_URL=http://localhost:6333

# Gemini API
GEMINI_API_KEY=your_gemini_key

# Integrations
SLACK_WEBHOOK_URL=https://hooks.slack.com/services/xxxx
WEBHOOK_SITE_URL=https://webhook.site/xxxx
Features Implemented
Phase 1: Real-time IMAP IDLE sync (no polling)

Phase 2: Email indexing and search via Elasticsearch

Phase 3: LLM classification → five categories (Interested, Meeting Booked, etc.)

Phase 4: Slack + Webhook notifications for Interested leads

Phase 5: React UI for searching, filtering, and viewing categorized emails

Phase 6: RAG pipeline for AI-powered context-aware reply suggestions

API Endpoints
Endpoint	Method	Description
/api/accounts	GET	List configured email accounts
/api/emails	GET	Fetch paginated email list
/api/emails/search?q=&account=&folder=	GET	Full-text and filtered search
/api/emails/:id/suggest-reply	POST	Generate AI-based contextual suggested reply
/api/health	GET	Health check
Evaluation Criteria
Criterion	Focus
Real-Time Performance	Uses IMAP IDLE (no poll/cron)
Code Quality	Modular TypeScript, structured errors
Search	Keyword + full-text matching in ES
AI Accuracy	Reliable Gemini prompt/schema usage
RAG Implementation	Grounded suggestions using Qdrant
Integration	Slack & Webhook tested triggers
Demo Instructions
docker-compose up -d (start data services)

npm run dev (start backend server)

cd frontend && npm start (launch UI at http://localhost:3001)


