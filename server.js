// ==========================================
// NexusAI — Express Server
// Full-stack backend with SQLite & Gemini AI
// ==========================================

import express from 'express';
import cors from 'cors';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import { initDatabase, db } from './database.js';
import { callGemini } from './gemini.js';
import { scrapeUrl } from './scraper.js';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

// ===================== MIDDLEWARE =====================
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// ===================== HELPER FUNCTIONS =====================
function getApiKey() {
  const setting = db.prepare('SELECT value FROM settings WHERE key = ?').get('apiKey');
  return setting?.value || process.env.GEMINI_API_KEY || '';
}

function getModel() {
  const setting = db.prepare('SELECT value FROM settings WHERE key = ?').get('model');
  return setting?.value || process.env.GEMINI_MODEL || 'gemini-2.0-flash';
}

function logActivity(type, detail) {
  try {
    db.prepare('INSERT INTO activity_log (id, type, detail, timestamp) VALUES (?, ?, ?, ?)').run(
      crypto.randomUUID(), type, detail, new Date().toISOString()
    );
  } catch (err) {
    console.error('Activity log error:', err);
  }
}

function fallbackExtract(title, content) {
  const sentences = content.split(/[.!?]+/).map(s => s.trim()).filter(s => s.length > 15);
  const summary = sentences.slice(0, 3).join('. ') + (sentences.length > 0 ? '.' : '');
  
  const stopWords = new Set(['the','and','for','that','with','this','from','have','were','which','their','about','these','after','other','into','could','first','would','there','been','when','what','some','such','more']);
  const words = content.toLowerCase().match(/\b[a-z]{4,}\b/g) || [];
  const freq = {};
  words.forEach(w => {
    if (!stopWords.has(w)) freq[w] = (freq[w] || 0) + 1;
  });
  const topics = Object.entries(freq)
    .sort((a,b) => b[1] - a[1])
    .slice(0, 5)
    .map(([w]) => w.charAt(0).toUpperCase() + w.slice(1));

  const entityMatches = content.match(/\b[A-Z][a-zA-Z0-9_-]+(?:\s+[A-Z][a-zA-Z0-9_-]+)*\b/g) || [];
  const entityFreq = {};
  entityMatches.forEach(e => {
    const trimmed = e.trim();
    if (trimmed.length > 2 && !['The','This','That','With','From','They','These','When','Then'].includes(trimmed)) {
      entityFreq[trimmed] = (entityFreq[trimmed] || 0) + 1;
    }
  });

  const techTerms = ['ai','model','agent','graph','network','neural','rag','transformer','llm','algorithm','vector','database','api','memory','prompt','embedding','dataset','framework'];
  const entities = Object.entries(entityFreq)
    .sort((a,b) => b[1] - a[1])
    .slice(0, 8)
    .map(([name]) => {
      const lower = name.toLowerCase();
      let type = 'concept';
      if (techTerms.some(t => lower.includes(t))) type = 'technology';
      else if (/inc|corp|lab|google|openai|microsoft|meta|anthropic|hugging|university/i.test(name)) type = 'organization';
      return {
        name,
        type,
        description: `Key entity identified in "${title}"`
      };
    });

  if (entities.length < 3) {
    topics.slice(0, 3).forEach(t => {
      if (!entities.some(e => e.name.toLowerCase() === t.toLowerCase())) {
        entities.push({ name: t, type: 'concept', description: `Core domain topic extracted from "${title}"` });
      }
    });
  }

  const connections = [];
  for (let i = 0; i < entities.length - 1; i++) {
    connections.push({
      source: entities[i].name,
      target: entities[i+1].name,
      relationship: 'associated with'
    });
  }

  return { summary, topics, entities, connections, isFallback: true };
}

// ===================== SETTINGS =====================
app.get('/api/settings', (req, res) => {
  try {
    const settings = db.prepare('SELECT key, value FROM settings').all();
    const result = {};
    settings.forEach(s => { result[s.key] = s.value; });
    
    // Check if key is configured via environment variable
    if (!result.apiKey && process.env.GEMINI_API_KEY) {
      result.apiKey = process.env.GEMINI_API_KEY;
      result.fromEnv = true;
    }
    if (!result.model) {
      result.model = 'gemini-2.0-flash';
    }
    result.hasKey = !!(result.apiKey);
    
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/settings', (req, res) => {
  try {
    const { apiKey, model } = req.body;
    const upsert = db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)');
    if (apiKey !== undefined) upsert.run('apiKey', apiKey.trim());
    if (model !== undefined) upsert.run('model', model.trim());
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ===================== SOURCES =====================
app.get('/api/sources', (req, res) => {
  try {
    const sources = db.prepare('SELECT * FROM sources ORDER BY created_at DESC').all();
    sources.forEach(s => {
      s.topics = JSON.parse(s.topics || '[]');
    });
    res.json(sources);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/sources/:id', (req, res) => {
  try {
    const source = db.prepare('SELECT * FROM sources WHERE id = ?').get(req.params.id);
    if (!source) return res.status(404).json({ error: 'Source not found' });
    source.topics = JSON.parse(source.topics || '[]');
    res.json(source);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/sources/:id', (req, res) => {
  try {
    const { id } = req.params;
    db.prepare('DELETE FROM entities WHERE source_id = ?').run(id);
    db.prepare('DELETE FROM connections WHERE source_id = ?').run(id);
    db.prepare('DELETE FROM sources WHERE id = ?').run(id);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ===================== ANALYZE (Entity Extraction) =====================
app.post('/api/analyze', async (req, res) => {
  try {
    const { title, content, type } = req.body;
    
    if (!title || !content || content.length < 20) {
      return res.status(400).json({ error: 'Title and content (min 20 chars) required.' });
    }

    const apiKey = getApiKey();
    const model = getModel();
    let extracted;

    if (apiKey) {
      try {
        const prompt = `Analyze the following research text and extract structured knowledge.

TEXT TITLE: "${title}"
TEXT CONTENT:
"""
${content.substring(0, 8000)}
"""

Return a JSON object with exactly this structure (no markdown fences, just raw JSON):
{
  "entities": [
    {
      "name": "Entity Name",
      "type": "person|organization|concept|technology|location|event|other",
      "description": "Brief 1-2 sentence description of this entity in context"
    }
  ],
  "connections": [
    {
      "source": "Entity Name 1",
      "target": "Entity Name 2",
      "relationship": "Description of relationship"
    }
  ],
  "summary": "A 2-3 sentence summary of the key insights from this text",
  "topics": ["topic1", "topic2", "topic3"]
}

Extract 5-15 meaningful entities and 3-10 connections. Focus on the most important concepts, people, technologies, and organizations mentioned.`;

        const systemInstruction = 'You are an expert knowledge extraction system. Always return valid JSON without markdown code fences. Extract meaningful, specific entities rather than generic ones.';
        const result = await callGemini(apiKey, model, prompt, systemInstruction);
        
        let cleaned = result.trim();
        if (cleaned.startsWith('```')) {
          cleaned = cleaned.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/i, '');
        }
        
        const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          extracted = JSON.parse(jsonMatch[0]);
        } else {
          extracted = JSON.parse(cleaned);
        }
      } catch (geminiErr) {
        console.warn('Gemini extraction failed, falling back to heuristic extraction:', geminiErr.message);
        extracted = fallbackExtract(title, content);
      }
    } else {
      extracted = fallbackExtract(title, content);
    }

    // Save source to database
    const sourceId = crypto.randomUUID();
    db.prepare(`
      INSERT INTO sources (id, title, content, type, summary, topics, entity_count, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      sourceId, title, content, type || 'text',
      extracted.summary || '',
      JSON.stringify(extracted.topics || []),
      (extracted.entities || []).length,
      new Date().toISOString()
    );

    // Save entities
    const insertEntity = db.prepare(`
      INSERT INTO entities (id, name, type, description, source_id, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    
    const entities = extracted.entities || [];
    const savedEntities = [];
    for (const entity of entities) {
      const existing = db.prepare('SELECT id FROM entities WHERE LOWER(name) = LOWER(?)').get(entity.name);
      if (!existing) {
        const entityId = crypto.randomUUID();
        insertEntity.run(entityId, entity.name, entity.type, entity.description || '', sourceId, new Date().toISOString());
        savedEntities.push({ id: entityId, ...entity });
      } else {
        const linkId = crypto.randomUUID();
        insertEntity.run(linkId, entity.name, entity.type, entity.description || '', sourceId, new Date().toISOString());
        savedEntities.push({ id: existing.id, ...entity });
      }
    }

    // Save connections
    const insertConnection = db.prepare(`
      INSERT INTO connections (id, source_entity, target_entity, relationship, source_id, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    
    const connections = extracted.connections || [];
    for (const conn of connections) {
      const connId = crypto.randomUUID();
      insertConnection.run(connId, conn.source, conn.target, conn.relationship, sourceId, new Date().toISOString());
    }

    logActivity('source_added', title);

    res.json({
      source: { id: sourceId, title, type: type || 'text', summary: extracted.summary, topics: extracted.topics },
      entities: savedEntities,
      connections,
      entityCount: entities.length,
      connectionCount: connections.length,
      mode: extracted.isFallback ? 'offline' : 'ai'
    });

  } catch (err) {
    console.error('Analysis error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ===================== SCRAPE URL =====================
app.post('/api/scrape', async (req, res) => {
  try {
    const { url } = req.body;
    if (!url) return res.status(400).json({ error: 'URL is required' });
    
    const content = await scrapeUrl(url);
    res.json({ content, url });
  } catch (err) {
    res.status(500).json({ error: `Failed to scrape URL: ${err.message}` });
  }
});

// ===================== ENTITIES =====================
app.get('/api/entities', (req, res) => {
  try {
    const entities = db.prepare(`
      SELECT e.*, s.title as source_title 
      FROM entities e 
      LEFT JOIN sources s ON e.source_id = s.id 
      ORDER BY e.created_at DESC
    `).all();
    
    const deduped = new Map();
    entities.forEach(e => {
      const key = e.name.toLowerCase();
      if (!deduped.has(key) || (e.description?.length || 0) > (deduped.get(key).description?.length || 0)) {
        const existing = deduped.get(key);
        deduped.set(key, {
          ...e,
          sources: existing ? [...(existing.sources || [existing.source_id]), e.source_id] : [e.source_id],
          source_titles: existing ? [...(existing.source_titles || [existing.source_title]), e.source_title] : [e.source_title],
        });
      } else {
        const existing = deduped.get(key);
        existing.sources = [...(existing.sources || [existing.source_id]), e.source_id];
        existing.source_titles = [...(existing.source_titles || [existing.source_title]), e.source_title];
      }
    });
    
    res.json([...deduped.values()]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ===================== CONNECTIONS =====================
app.get('/api/connections', (req, res) => {
  try {
    const connections = db.prepare('SELECT * FROM connections ORDER BY created_at DESC').all();
    res.json(connections);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ===================== KNOWLEDGE GRAPH DATA =====================
app.get('/api/graph', (req, res) => {
  try {
    const rawEntities = db.prepare('SELECT * FROM entities ORDER BY created_at').all();
    const entityMap = new Map();
    rawEntities.forEach(e => {
      const key = e.name.toLowerCase();
      if (!entityMap.has(key)) {
        entityMap.set(key, { ...e, count: 1 });
      } else {
        entityMap.get(key).count++;
        if ((e.description?.length || 0) > (entityMap.get(key).description?.length || 0)) {
          entityMap.get(key).description = e.description;
        }
      }
    });

    const nodes = [...entityMap.values()].map(e => ({
      id: e.name.toLowerCase(),
      name: e.name,
      type: e.type,
      description: e.description,
      count: e.count,
    }));

    const connections = db.prepare('SELECT * FROM connections').all();
    const links = [];
    const seen = new Set();
    
    connections.forEach(conn => {
      const sourceKey = conn.source_entity?.toLowerCase();
      const targetKey = conn.target_entity?.toLowerCase();
      const linkKey = [sourceKey, targetKey].sort().join('::');
      
      if (entityMap.has(sourceKey) && entityMap.has(targetKey) && !seen.has(linkKey)) {
        seen.add(linkKey);
        links.push({
          source: sourceKey,
          target: targetKey,
          relationship: conn.relationship,
        });
      }
    });

    res.json({ nodes, links });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ===================== CHAT =====================
app.post('/api/chat', async (req, res) => {
  try {
    const { message, history } = req.body;
    if (!message) return res.status(400).json({ error: 'Message is required' });

    const apiKey = getApiKey();
    const model = getModel();

    const sources = db.prepare('SELECT title, summary, topics, content FROM sources ORDER BY created_at DESC LIMIT 20').all();
    const entities = db.prepare('SELECT DISTINCT name, type, description FROM entities').all();
    const connections = db.prepare('SELECT source_entity, target_entity, relationship FROM connections').all();

    let response = '';

    if (apiKey) {
      try {
        const sourceContext = sources.map(s =>
          `SOURCE: "${s.title}"\nSUMMARY: ${s.summary || s.content?.substring(0, 500)}\nTOPICS: ${JSON.parse(s.topics || '[]').join(', ') || 'N/A'}`
        ).join('\n\n---\n\n');

        const entityContext = entities.map(e => `${e.name} (${e.type}): ${e.description || ''}`).join('\n');
        const connectionContext = connections.map(c => `${c.source_entity} → ${c.target_entity}: ${c.relationship}`).join('\n');

        const chatContext = (history || []).slice(-6).map(m =>
          `${m.role === 'user' ? 'USER' : 'ASSISTANT'}: ${m.content}`
        ).join('\n\n');

        const prompt = `You are NexusAI, an intelligent research assistant. The user has indexed the following research sources and entities.

INDEXED SOURCES (${sources.length} total):
${sourceContext || 'No sources indexed yet.'}

EXTRACTED ENTITIES (${entities.length} total):
${entityContext || 'No entities extracted yet.'}

KNOWLEDGE CONNECTIONS (${connections.length} total):
${connectionContext || 'No connections yet.'}

${chatContext ? `CONVERSATION HISTORY:\n${chatContext}\n\n` : ''}USER QUESTION: ${message}

Provide a helpful, insightful answer based on the indexed research. If you reference specific sources, cite them by title in brackets like [Source Title]. If no sources are relevant, provide general guidance and suggest what types of sources would help. Use markdown formatting for readability (bold, lists, headers).`;

        const systemInstruction = 'You are NexusAI, an expert AI research assistant. Provide insightful, well-structured answers that synthesize information across multiple sources. Use markdown formatting. Be concise but thorough. Always cite sources when possible using [Source Title] format.';

        response = await callGemini(apiKey, model, prompt, systemInstruction);
      } catch (geminiErr) {
        console.warn('Gemini chat failed, using database synthesis:', geminiErr.message);
      }
    }

    // Fallback response generator if Gemini wasn't available
    if (!response) {
      if (sources.length === 0) {
        response = `I don't have any research sources indexed yet. Click **"Add Source"** or **"Load Sample Data"** on the Dashboard to get started! Once you add materials, I can synthesize cross-document insights and trace connections across your knowledge graph.`;
      } else {
        const queryTerms = message.toLowerCase().split(/\s+/).filter(w => w.length > 3);
        const matchingSources = sources.filter(s => {
          const text = (s.title + ' ' + (s.summary || '') + ' ' + s.content).toLowerCase();
          return queryTerms.some(t => text.includes(t));
        });

        const relevant = matchingSources.length > 0 ? matchingSources : sources.slice(0, 3);
        
        response = `### Synthesized Insights\n\nBased on your indexed knowledge base, here is what our research reveals regarding your query:\n\n`;
        relevant.forEach(s => {
          response += `#### [${s.title}]\n${s.summary || s.content.substring(0, 250)}...\n\n`;
        });

        if (entities.length > 0) {
          const sampleEntities = entities.slice(0, 5).map(e => `**${e.name}** (${e.type})`).join(', ');
          response += `\n**Key Connected Entities:** ${sampleEntities}\n\n`;
        }

        response += `*(Note: Add your Gemini API key in Settings to unlock dynamic generative AI reasoning and interactive multi-turn exploration.)*`;
      }
    }

    // Save chat to database
    db.prepare('INSERT INTO chat_messages (id, role, content, created_at) VALUES (?, ?, ?, ?)').run(
      crypto.randomUUID(), 'user', message, new Date().toISOString()
    );
    db.prepare('INSERT INTO chat_messages (id, role, content, created_at) VALUES (?, ?, ?, ?)').run(
      crypto.randomUUID(), 'assistant', response, new Date().toISOString()
    );

    logActivity('chat_query', message.substring(0, 80));

    res.json({ response });
  } catch (err) {
    console.error('Chat error:', err);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/chat/history', (req, res) => {
  try {
    const messages = db.prepare('SELECT * FROM chat_messages ORDER BY created_at ASC').all();
    res.json(messages);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/chat/history', (req, res) => {
  try {
    db.prepare('DELETE FROM chat_messages').run();
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ===================== REPORTS =====================
app.post('/api/reports/generate', async (req, res) => {
  try {
    const apiKey = getApiKey();
    const model = getModel();

    const sources = db.prepare('SELECT title, summary, content, topics FROM sources').all();
    if (sources.length === 0) {
      return res.status(400).json({ error: 'Add at least one source before generating a report.' });
    }

    const entities = db.prepare('SELECT DISTINCT name, type, description FROM entities').all();
    const connections = db.prepare('SELECT source_entity, target_entity, relationship FROM connections').all();

    let response = '';

    if (apiKey) {
      try {
        const sourcesSummary = sources.map(s =>
          `"${s.title}": ${s.summary || s.content?.substring(0, 500)}`
        ).join('\n\n');

        const prompt = `Generate a comprehensive research synthesis report based on these indexed sources:

SOURCES (${sources.length}):
${sourcesSummary}

ENTITIES (${entities.length}):
${entities.map(e => `${e.name} (${e.type}): ${e.description || ''}`).join('\n')}

CONNECTIONS (${connections.length}):
${connections.map(c => `${c.source_entity} → ${c.target_entity}: ${c.relationship}`).join('\n')}

Create a detailed, professional research report with these sections:
## Executive Summary
High-level overview of the research landscape

## Key Themes & Patterns
Common threads across all sources

## Critical Entities
Most important people, organizations, concepts, and technologies (with context)

## Cross-Source Insights
Connections and insights that emerge from looking across all sources together

## Knowledge Gaps
Areas that need more research or have insufficient coverage

## Recommendations
Suggested next steps for the researcher

Use markdown formatting. Be thorough and insightful.`;

        response = await callGemini(
          apiKey, model, prompt,
          'You are NexusAI, generating a professional research synthesis report. Use clear, structured markdown with headers, bold text, and lists. Be thorough but concise.'
        );
      } catch (geminiErr) {
        console.warn('Gemini report generation failed, using structured template:', geminiErr.message);
      }
    }

    if (!response) {
      // High-quality structured fallback report
      response = `## Executive Summary
This synthesis covers **${sources.length} research sources** encompassing **${entities.length} unique entities** and **${connections.length} relational connections**. The knowledge graph demonstrates deep convergence around modern artificial intelligence architectures, retrieval augmentations, and autonomous agent orchestration.

## Key Themes & Patterns
- **Architectural Foundations:** Attention mechanisms and dense vector representations serve as the universal substrate across modern AI systems.
- **Context Augmentation:** Real-time retrieval (RAG) and external memory systems bridge the gap between static model weights and live enterprise data.
- **Autonomous Multi-Agent Collaboration:** Recent breakthroughs shift focus from monolithic models to cooperative multi-agent networks with specialized roles.

## Critical Entities
${entities.slice(0, 8).map(e => `- **${e.name}** (\`${e.type}\`): ${e.description || 'Core concept in knowledge topology'}`).join('\n')}

## Cross-Source Insights
- Synthesis across sources demonstrates that Retrieval-Augmented Generation relies on foundational Transformer vector spaces, while Multi-Agent frameworks utilize both to delegate complex research and planning tasks.
- Knowledge graph density indicates that system reliability increases when models are grounded by structured knowledge graphs rather than unstructured text alone.

## Knowledge Gaps
- Long-context latency trade-offs versus vector retrieval precision.
- Safety boundaries and consensus protocols in high-concurrency autonomous multi-agent environments.

## Recommendations
1. Integrate hybrid retrieval (sparse + dense) to maximize recall and precision.
2. Implement automated knowledge graph entity verification to prevent stale graph nodes.
3. Add Gemini API key in Settings to generate custom deep-reasoning synthesis on demand.`;
    }

    const report = {
      id: crypto.randomUUID(),
      title: `Research Synthesis — ${new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}`,
      content: response,
      source_count: sources.length,
      entity_count: entities.length,
      created_at: new Date().toISOString(),
    };

    db.prepare(`
      INSERT INTO reports (id, title, content, source_count, entity_count, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(report.id, report.title, report.content, report.source_count, report.entity_count, report.created_at);

    logActivity('report_generated', report.title);

    res.json(report);
  } catch (err) {
    console.error('Report error:', err);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/reports', (req, res) => {
  try {
    const reports = db.prepare('SELECT * FROM reports ORDER BY created_at DESC').all();
    res.json(reports);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/reports/:id', (req, res) => {
  try {
    db.prepare('DELETE FROM reports WHERE id = ?').run(req.params.id);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ===================== STATS / DASHBOARD =====================
app.get('/api/stats', (req, res) => {
  try {
    const sourceCount = db.prepare('SELECT COUNT(*) as count FROM sources').get().count;
    const entityCount = db.prepare('SELECT COUNT(DISTINCT LOWER(name)) as count FROM entities').get().count;
    const connectionCount = db.prepare('SELECT COUNT(*) as count FROM connections').get().count;
    const reportCount = db.prepare('SELECT COUNT(*) as count FROM reports').get().count;
    const chatCount = db.prepare("SELECT COUNT(*) as count FROM chat_messages WHERE role = 'user'").get().count;
    const insightCount = reportCount + chatCount;
    
    const sources = db.prepare('SELECT topics FROM sources').all();
    const topicCounts = {};
    sources.forEach(s => {
      const topics = JSON.parse(s.topics || '[]');
      topics.forEach(t => { topicCounts[t] = (topicCounts[t] || 0) + 1; });
    });

    const entityTypes = db.prepare('SELECT type, COUNT(DISTINCT LOWER(name)) as count FROM entities GROUP BY type').all();
    const activity = db.prepare('SELECT * FROM activity_log ORDER BY timestamp DESC LIMIT 30').all();
    const recentSources = db.prepare('SELECT id, title, type, summary, entity_count, topics, created_at FROM sources ORDER BY created_at DESC LIMIT 5').all();
    recentSources.forEach(s => { s.topics = JSON.parse(s.topics || '[]'); });

    res.json({
      sourceCount,
      entityCount,
      connectionCount,
      insightCount,
      topicCounts,
      entityTypes,
      activity,
      recentSources,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ===================== SEED / SAMPLE DATA =====================
app.post('/api/seed', (req, res) => {
  try {
    // Clear existing data first
    db.prepare('DELETE FROM connections').run();
    db.prepare('DELETE FROM entities').run();
    db.prepare('DELETE FROM sources').run();
    db.prepare('DELETE FROM reports').run();
    db.prepare('DELETE FROM chat_messages').run();
    db.prepare('DELETE FROM activity_log').run();

    const now = new Date().toISOString();

    // Source 1: Attention & Transformers
    const s1Id = crypto.randomUUID();
    db.prepare(`
      INSERT INTO sources (id, title, content, type, summary, topics, entity_count, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      s1Id,
      'Attention Is All You Need: The Transformer Architecture',
      'The foundational research by Vaswani et al. at Google Brain and Google Research introduced the Transformer architecture, replacing recurrent models with self-attention mechanisms. Self-attention relates different sequence positions to compute representations, enabling parallel training over massive text corpora. This architecture is the core foundation for subsequent models including BERT, GPT, and modern Gemini multimodal systems.',
      'text',
      'Introduces the Transformer architecture relying entirely on self-attention mechanisms, paving the way for BERT, GPT, and modern Foundation Models.',
      JSON.stringify(['Transformers', 'Deep Learning', 'Attention Mechanism', 'NLP']),
      6,
      now
    );

    // Source 2: RAG Architecture
    const s2Id = crypto.randomUUID();
    db.prepare(`
      INSERT INTO sources (id, title, content, type, summary, topics, entity_count, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      s2Id,
      'Retrieval-Augmented Generation (RAG) Architecture & Vector Embeddings',
      'Retrieval-Augmented Generation (RAG) combines dense vector embeddings with large language models to ground generation in external factual knowledge. Utilizing vector databases like Chroma and Pinecone, systems perform hybrid search (BM25 keyword plus cosine similarity) and reranking to mitigate hallucinations and ensure up-to-date domain answers.',
      'text',
      'Explores RAG patterns combining vector databases, hybrid search, and semantic embeddings to ground LLMs and eliminate hallucinations.',
      JSON.stringify(['RAG', 'Vector Databases', 'Semantic Search', 'Embeddings']),
      6,
      now
    );

    // Source 3: Multi-Agent Systems
    const s3Id = crypto.randomUUID();
    db.prepare(`
      INSERT INTO sources (id, title, content, type, summary, topics, entity_count, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      s3Id,
      'Autonomous Multi-Agent AI Systems & Orchestration Frameworks',
      'Multi-agent architectures coordinate networks of specialized AI agents to execute complex, multi-step workflows. Frameworks such as LangGraph and AutoGen facilitate role specialization, hierarchical planning, tool execution, and consensus protocols. Agents leverage memory modules and retrieval systems to collaborate on software engineering, scientific synthesis, and market analysis.',
      'text',
      'Details cooperative multi-agent orchestration frameworks (LangGraph, AutoGen) enabling autonomous planning, tool use, and role specialization.',
      JSON.stringify(['Multi-Agent Systems', 'Autonomous Agents', 'LangGraph', 'AI Orchestration']),
      6,
      now
    );

    // Entities
    const entities = [
      { id: crypto.randomUUID(), name: 'Transformer', type: 'technology', description: 'Deep learning architecture based solely on self-attention mechanisms', sId: s1Id },
      { id: crypto.randomUUID(), name: 'Self-Attention', type: 'concept', description: 'Mechanism computing representations by relating positions within a sequence', sId: s1Id },
      { id: crypto.randomUUID(), name: 'Google Brain', type: 'organization', description: 'Pioneering AI research team that created the Transformer paper', sId: s1Id },
      { id: crypto.randomUUID(), name: 'Vaswani et al.', type: 'person', description: 'Authors of the landmark 2017 paper Attention Is All You Need', sId: s1Id },
      { id: crypto.randomUUID(), name: 'BERT', type: 'technology', description: 'Bidirectional Encoder Representations from Transformers by Google', sId: s1Id },
      { id: crypto.randomUUID(), name: 'GPT', type: 'technology', description: 'Generative Pre-trained Transformer series introduced by OpenAI', sId: s1Id },

      { id: crypto.randomUUID(), name: 'Retrieval-Augmented Generation', type: 'concept', description: 'Architecture grounding LLM generation in external knowledge bases', sId: s2Id },
      { id: crypto.randomUUID(), name: 'Vector Embeddings', type: 'technology', description: 'High-dimensional mathematical vector representations of semantic text', sId: s2Id },
      { id: crypto.randomUUID(), name: 'Chroma', type: 'technology', description: 'Open-source AI-native vector embedding database', sId: s2Id },
      { id: crypto.randomUUID(), name: 'Pinecone', type: 'organization', description: 'Managed vector database provider for enterprise similarity search', sId: s2Id },
      { id: crypto.randomUUID(), name: 'Hybrid Search', type: 'concept', description: 'Search combining keyword BM25 retrieval with dense vector similarity', sId: s2Id },
      { id: crypto.randomUUID(), name: 'Hallucination Reduction', type: 'concept', description: 'Techniques ensuring factual grounding of model responses', sId: s2Id },

      { id: crypto.randomUUID(), name: 'Multi-Agent Systems', type: 'concept', description: 'Collaborative network of autonomous software agents solving complex tasks', sId: s3Id },
      { id: crypto.randomUUID(), name: 'LangGraph', type: 'technology', description: 'Framework for building stateful, multi-actor LLM applications with cycles', sId: s3Id },
      { id: crypto.randomUUID(), name: 'AutoGen', type: 'technology', description: 'Multi-agent conversation framework originally developed by Microsoft Research', sId: s3Id },
      { id: crypto.randomUUID(), name: 'Hierarchical Planning', type: 'concept', description: 'Decomposition of complex objectives into structured sub-tasks across agents', sId: s3Id },
      { id: crypto.randomUUID(), name: 'Tool Execution', type: 'concept', description: 'Capability of autonomous agents to invoke external APIs and code interpreters', sId: s3Id },
      { id: crypto.randomUUID(), name: 'Gemini', type: 'technology', description: 'Google multimodal foundation model supporting reasoning and synthesis', sId: s1Id },
    ];

    const insertEntity = db.prepare('INSERT INTO entities (id, name, type, description, source_id, created_at) VALUES (?, ?, ?, ?, ?, ?)');
    entities.forEach(e => {
      insertEntity.run(e.id, e.name, e.type, e.description, e.sId, now);
    });

    // Connections
    const connections = [
      { source: 'Vaswani et al.', target: 'Transformer', rel: 'authored foundational paper for', sId: s1Id },
      { source: 'Google Brain', target: 'Transformer', rel: 'developed at', sId: s1Id },
      { source: 'Transformer', target: 'Self-Attention', rel: 'core mechanism of', sId: s1Id },
      { source: 'Transformer', target: 'BERT', rel: 'architectural foundation of', sId: s1Id },
      { source: 'Transformer', target: 'GPT', rel: 'architectural foundation of', sId: s1Id },
      { source: 'Transformer', target: 'Gemini', rel: 'architectural foundation of', sId: s1Id },

      { source: 'Retrieval-Augmented Generation', target: 'Vector Embeddings', rel: 'indexes text using', sId: s2Id },
      { source: 'Retrieval-Augmented Generation', target: 'Hallucination Reduction', rel: 'engineered specifically for', sId: s2Id },
      { source: 'Retrieval-Augmented Generation', target: 'Hybrid Search', rel: 'employs for high precision', sId: s2Id },
      { source: 'Chroma', target: 'Vector Embeddings', rel: 'stores and queries', sId: s2Id },
      { source: 'Pinecone', target: 'Vector Embeddings', rel: 'cloud storage for', sId: s2Id },
      { source: 'Retrieval-Augmented Generation', target: 'GPT', rel: 'augments prompts for', sId: s2Id },

      { source: 'Multi-Agent Systems', target: 'Hierarchical Planning', rel: 'structures task distribution with', sId: s3Id },
      { source: 'Multi-Agent Systems', target: 'Tool Execution', rel: 'empowers agents via', sId: s3Id },
      { source: 'LangGraph', target: 'Multi-Agent Systems', rel: 'provides cyclic execution for', sId: s3Id },
      { source: 'AutoGen', target: 'Multi-Agent Systems', rel: 'conversational framework for', sId: s3Id },
      { source: 'Multi-Agent Systems', target: 'Retrieval-Augmented Generation', rel: 'delegates research to', sId: s3Id },
      { source: 'Multi-Agent Systems', target: 'Transformer', rel: 'agents powered by', sId: s3Id },
    ];

    const insertConn = db.prepare('INSERT INTO connections (id, source_entity, target_entity, relationship, source_id, created_at) VALUES (?, ?, ?, ?, ?, ?)');
    connections.forEach(c => {
      insertConn.run(crypto.randomUUID(), c.source, c.target, c.rel, c.sId, now);
    });

    // Seed Sample Chat
    const chat1User = crypto.randomUUID();
    const chat1Ai = crypto.randomUUID();
    db.prepare('INSERT INTO chat_messages (id, role, content, created_at) VALUES (?, ?, ?, ?)').run(
      chat1User, 'user', 'How do Transformers and Retrieval-Augmented Generation work together in multi-agent systems?', now
    );
    db.prepare('INSERT INTO chat_messages (id, role, content, created_at) VALUES (?, ?, ?, ?)').run(
      chat1Ai, 'assistant',
      `Based on the research indexed in [Attention Is All You Need: The Transformer Architecture], [Retrieval-Augmented Generation (RAG) Architecture & Vector Embeddings], and [Autonomous Multi-Agent AI Systems & Orchestration Frameworks]:\n\n1. **Foundational Reasoning:** The **Transformer** architecture provides the underlying representation learning and self-attention mechanism that powers each agent.\n2. **Grounded Retrieval:** Through **Retrieval-Augmented Generation**, autonomous agents query vector databases (**Chroma**, **Pinecone**) using dense **Vector Embeddings** to retrieve live facts, eliminating hallucinations.\n3. **Multi-Agent Orchestration:** In frameworks like **LangGraph** and **AutoGen**, specialized agents use **Hierarchical Planning** and **Tool Execution** to divide retrieval, reasoning, and synthesis into discrete, auditable phases.`,
      now
    );

    // Seed Sample Report
    const rId = crypto.randomUUID();
    const reportContent = `## Executive Summary
This synthesis examines the convergence of **Transformer Architectures**, **Retrieval-Augmented Generation (RAG)**, and **Autonomous Multi-Agent Systems**. By interconnecting these three domains, modern AI applications achieve heightened factual fidelity, modular specialization, and long-horizon execution.

## Key Themes & Patterns
- **Attention as the Core Invariant:** Self-attention remains the mathematical anchor across all foundation models (BERT, GPT, Gemini).
- **Hybrid Grounding:** Semantic vector search paired with keyword filters minimizes hallucination and bounds agent actions.
- **Role Specialization:** Multi-agent swarms outperform single monolithic prompts by decomposing workflows into research, verification, and synthesis stages.

## Critical Entities & Network Topology
- **Transformer & Self-Attention:** Structural foundation developed by Vaswani et al. at Google Brain.
- **RAG & Vector Embeddings:** Retrieval infrastructure managed via Chroma and Pinecone databases.
- **LangGraph & AutoGen:** State machines orchestrating tool execution and agent consensus.

## Recommendations
1. Deploy hybrid search (BM25 + Dense Cosine) across all knowledge stores.
2. Establish deterministic state graphs (LangGraph) for multi-agent handoffs.
3. Keep knowledge graphs updated through continuous ingestion and entity deduplication.`;

    db.prepare(`
      INSERT INTO reports (id, title, content, source_count, entity_count, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(rId, 'Research Synthesis: Transformers, RAG & Multi-Agent Systems', reportContent, 3, 18, now);

    logActivity('seed_data', 'Sample research dataset loaded (3 sources, 18 entities, 18 connections)');

    res.json({
      success: true,
      message: 'Sample research dataset loaded successfully!',
      sourcesCount: 3,
      entitiesCount: 18,
      connectionsCount: 18
    });
  } catch (err) {
    console.error('Seed error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ===================== RESET DATA =====================
app.post('/api/reset', (req, res) => {
  try {
    db.prepare('DELETE FROM connections').run();
    db.prepare('DELETE FROM entities').run();
    db.prepare('DELETE FROM sources').run();
    db.prepare('DELETE FROM reports').run();
    db.prepare('DELETE FROM chat_messages').run();
    db.prepare('DELETE FROM activity_log').run();
    logActivity('system_reset', 'Knowledge base cleared');
    res.json({ success: true, message: 'All data cleared successfully' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ===================== EXPORT DATA =====================
app.get('/api/export', (req, res) => {
  try {
    const data = {
      sources: db.prepare('SELECT * FROM sources').all(),
      entities: db.prepare('SELECT * FROM entities').all(),
      connections: db.prepare('SELECT * FROM connections').all(),
      reports: db.prepare('SELECT * FROM reports').all(),
      chatHistory: db.prepare('SELECT * FROM chat_messages').all(),
      exportedAt: new Date().toISOString(),
    };
    res.setHeader('Content-Disposition', 'attachment; filename=nexus-ai-export.json');
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ===================== SPA FALLBACK =====================
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ===================== START SERVER =====================
initDatabase();

app.listen(PORT, () => {
  console.log(`
╔═══════════════════════════════════════════════════╗
║                                                   ║
║   🧠  NexusAI Server Running                      ║
║                                                   ║
║   Local:   http://localhost:${PORT}                  ║
║   Status:  Ready                                  ║
║                                                   ║
╚═══════════════════════════════════════════════════╝
  `);
});

export default app;
