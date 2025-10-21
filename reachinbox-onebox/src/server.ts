import express from 'express';
import cors from 'cors';
import { Client as ElasticClient } from '@elastic/elasticsearch';
import Imap from 'node-imap';
import  {simpleParser}  from 'mailparser';
import fetch from 'node-fetch';
import dotenv from 'dotenv';

dotenv.config();

// Elasticsearch client setup
const elasticClient = new ElasticClient({ node: 'http://localhost:9200' });

// IMAP connection config and state
const imapConfig = {
  user: process.env.IMAP_USER!,
  password: process.env.IMAP_PASSWORD!,
  host: process.env.IMAP_HOST!,
  port: Number(process.env.IMAP_PORT) || 993,
  tls: true,
};

const imap = new Imap(imapConfig);

interface EmailDocument {
  subject: string;
  body: string;
  accountId: string;
  folder: string;
  date: Date;
  aiCategory?: string;
  sender: string;
  uid: string;
}

// Create Elasticsearch index with mapping if it doesn't exist
async function createIndex() {
  const exists = await elasticClient.indices.exists({ index: 'emails' });
  if (!exists) {
    await elasticClient.indices.create({
      index: 'emails',
      mappings: {
        properties: {
          subject: { type: 'text' },
          body: { type: 'text' },
          accountId: { type: 'keyword' },
          folder: { type: 'keyword' },
          date: { type: 'date' },
          aiCategory: { type: 'keyword' },
          sender: { type: 'keyword' },
          uid: { type: 'keyword' }
        }
      }
    });
    console.log('Created Elasticsearch index "emails"');
  }
}

// Index email document into Elasticsearch
async function indexEmail(email: EmailDocument) {
  await elasticClient.index({
    index: 'emails',
    id: email.uid,
    body: email,
  });
  await elasticClient.indices.refresh({ index: 'emails' });
  console.log(`Indexed email UID ${email.uid}: ${email.subject}`);
}

// Call Gemini API for email classification
async function classifyEmail(emailText: string): Promise<string> {
  const response = await fetch(process.env.GEMINI_API_URL!, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      systemInstruction: "You are an expert email classifier. Your task is to analyze the provided email text and categorize it into one of the following labels: Interested, Meeting Booked, Not Interested, Spam, or Out of Office.",
      input: emailText,
      responseMimeType: "application/json",
      responseSchema: {
        type: "OBJECT",
        properties: {
          category: {
            type: "STRING",
            enum: ["Interested", "Meeting Booked", "Not Interested", "Spam", "Out of Office"]
          }
        }
      }
    }),
  });

  type GeminiResponse = { category?: string };
  const data = (await response.json()) as unknown as GeminiResponse;
  const validCategories = ["Interested", "Meeting Booked", "Not Interested", "Spam", "Out of Office"];
  if (data && typeof data.category === 'string' && validCategories.includes(data.category)) {
    return data.category;
  }
  console.error('Unexpected classification response from Gemini:', data);
  // return a safe default category if response is invalid
  return 'Not Interested';
}

// Update indexed email with AI category
async function updateEmailCategory(uid: string, category: string) {
  await elasticClient.update({
    index: 'emails',
    id: uid,
    doc: {
      aiCategory: category
    }
  });
  await elasticClient.indices.refresh({ index: 'emails' });
  console.log(`Updated email UID ${uid} with category ${category}`);
}

// Trigger Slack and generic webhook for Interested emails
async function triggerWebhooks(email: EmailDocument) {
  if (email.aiCategory !== 'Interested') return;

  const slackUrl = process.env.SLACK_WEBHOOK_URL!;
  const webhookUrl = process.env.WEBHOOK_SITE_URL!;

  await fetch(slackUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      text: `*Interested Email*\nSubject: ${email.subject}\nFrom: ${email.sender}`,
    }),
  });

  await fetch(webhookUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ event: 'InterestedLead', email }),
  });

  console.log('Triggered webhooks for Interested email');
}

// Process a new email: index, classify, update, trigger webhooks
async function processNewEmail(emailData: EmailDocument) {
  await indexEmail(emailData);
  const category = await classifyEmail(emailData.body);
  await updateEmailCategory(emailData.uid, category);
  emailData.aiCategory = category;
  await triggerWebhooks(emailData);
}

// IMAP initial sync & IDLE real-time listening with watchdog
function openInbox(callback: (err?: any) => void) {
  imap.openBox('INBOX', false, callback);
}

function setupIdleWatchdog() {
  // Refresh IDLE every 29 minutes to avoid server timeout
  setInterval(() => {
    // node-imap's types may not expose the idle() method; cast to any and prefer idle(),
    // fallback to noop() if available, otherwise log so we don't call a non-existent method.
    const anyImap: any = imap;
    if (typeof anyImap.idle === 'function') {
      anyImap.idle();
      console.log('Sent IDLE command to keep IMAP connection alive');
    } else if (typeof anyImap.noop === 'function') {
      anyImap.noop();
      console.log('Sent NOOP command to keep IMAP connection alive');
    } else {
      console.log('No IDLE/NOOP method available to keep IMAP connection alive');
    }
  }, 29 * 60 * 1000);
}

imap.once('ready', () => {
  openInbox(async (err) => {
    if (err) throw err;

    // Initial sync: fetch emails since 30 days ago, fetch envelopes & bodystructure only
    imap.search([['SINCE', new Date(Date.now() - 30 * 24 * 3600 * 1000)]], (err, results) => {
      if (err) {
        console.error('Initial search error:', err);
        return;
      }
      if (!results || results.length === 0) {
        console.log('No emails to sync on initial fetch');
      } else {
        const fetcher = imap.fetch(results, { bodies: 'HEADER.FIELDS (FROM TO SUBJECT DATE)', struct: true });
        fetcher.on('message', (msg, seqno) => {
          const emailPartial: Partial<EmailDocument> = { accountId: imapConfig.user, folder: 'INBOX' };
          let uid = '';
          msg.on('attributes', (attrs) => {
            uid = attrs.uid.toString();
          });
          msg.on('body', (stream) => {
            let buffer = '';
            stream.on('data', (chunk) => (buffer += chunk.toString('utf8')));
            stream.once('end', () => {
              // Parse envelope header fields only here without full body to save bandwidth
              // We'll fetch body on real-time new mail event or later stages
            });
          });
          msg.once('end', () => {
            if (uid) {
              // For initial sync, you can optionally fetch full body or just store metadata for Phase 2
              // Here we skip full indexing, assuming Phase 2 will handle after IDLE event
            }
          });
        });
      }
    });

    // Start IDLE listener for real-time email
    imap.on('mail', (numNewMsgs) => {
      console.log(`New mail event: ${numNewMsgs} msg(s)`);
      const fetcher = imap.seq.fetch('1:*', { bodies: '', struct: true, markSeen: true });
      fetcher.on('message', (msg, seqno) => {
        let attributes: Imap.ImapMessageAttributes;
        msg.on('attributes', (attrs) => {
          attributes = attrs;
        });
        msg.on('body', async (stream: any) => {
          try {
            const parsed = await simpleParser(stream as any);
            const emailDoc: EmailDocument = {
              subject: parsed.subject || '',
              body: parsed.text || '',
              accountId: imapConfig.user,
              folder: 'INBOX',
              date: parsed.date || new Date(),
              sender: parsed.from?.text || '',
              uid: attributes.uid.toString()
            };
            await processNewEmail(emailDoc);
          } catch (e) {
            console.error('Error parsing incoming mail:', e);
          }
        });
      });
    });

    setupIdleWatchdog();
  });
});

imap.once('error', (err) => {
  console.error('IMAP error:', err);
  // Could add reconnection logic here in production
});

imap.once('end', () => {
  console.log('IMAP connection ended');
  // Could add reconnection logic here
});

imap.connect();

const app = express();
app.use(express.json());
app.use(cors());

// API endpoint - email search/filter with pagination
app.get('/api/emails/search', async (req, res) => {
  try {
    const { q = '', accountId, folder, page = '1', size = '20' } = req.query;

    const esQuery: any = {
      from: (parseInt(page as string) - 1) * parseInt(size as string),
      size: parseInt(size as string),
      query: {
        bool: {
          must: q ? [{ multi_match: { query: q, fields: ['subject', 'body'] } }] : [{ match_all: {} }],
          filter: [],
        },
      },
    };

    if (accountId) esQuery.query.bool.filter.push({ term: { accountId } });
    if (folder) esQuery.query.bool.filter.push({ term: { folder } });

    const result = await elasticClient.search({ index: 'emails', body: esQuery });

    res.json(result.hits.hits.map((hit: any) => hit._source));
  } catch (error) {
    console.error('Search error:', error);
    res.status(500).json({ error: 'Search failed' });
  }
});

const PORT = process.env.PORT || 3000;

createIndex().then(() => {
  app.listen(PORT, () => {
    console.log(`Server started on port ${PORT}`);
  });
}).catch(console.error);
