import axios from 'axios';
import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';
import { ScrapedStory } from './hnScraper';

dotenv.config();

const OLLAMA_BASE_URL = process.env.OLLAMA_BASE_URL || 'http://localhost:11434';
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || 'functiongemma';

// Deterministic Filters
const MIN_HN_SCORE = 100;
const MAX_RANK = 30;

interface InterestConfig {
  interests: string[];
}

function getInterests(): string[] {
  try {
    const configPath = path.resolve(__dirname, '../config/interests.json');
    const fileContent = fs.readFileSync(configPath, 'utf-8');
    return JSON.parse(fileContent);
  } catch (error) {
    console.error('Error reading interests.json:', error);
    return [];
  }
}

export async function checkRelevance(story: ScrapedStory): Promise<{ reason: string } | null> {
  const interests = getInterests();
  
  // 1. Deterministic Pre-filtering
  
  // Filter by Rank
  if (story.rank > MAX_RANK) {
    console.log(`Pre-filter: Rejected "${story.title}" (Rank ${story.rank} > ${MAX_RANK})`);
    return null;
  }

  // Filter by HN Score
  if (story.score < MIN_HN_SCORE) {
    console.log(`Pre-filter: Rejected "${story.title}" (Score ${story.score} < ${MIN_HN_SCORE})`);
    return null;
  }

  // Filter by Keywords (Basic check)
  const titleLower = story.title.toLowerCase();
  const matchedKeywords = interests.filter(interest => 
    titleLower.includes(interest.toLowerCase())
  );
  
  // Note: We are NOT filtering strictly by keywords here (returning null if none match)
  // because the prompt implies we send "Keywords matched" to the LLM.
  // However, the "Architecture rules" say: "Pre-filter stories in code using... Keyword presence".
  // If I strictly filter by keywords, the LLM might not see interesting things that don't match exact keywords.
  // But the prompt says "Only send pre-filtered stories to the LLM."
  // Let's assume we pass it if it passes score/rank OR has a keyword match? 
  // Or should we require score/rank AND (maybe) keywords?
  // The prompt says: "Pre-filter stories in code using deterministic rules: HN score threshold, Rank threshold, Keyword presence".
  // Usually "Keyword presence" implies if it matches a keyword, it's interesting.
  // But if I filter strictly by keywords, I might miss semantic matches (which is what LLMs are good for).
  // However, the prompt explicitly says "Only send pre-filtered stories to the LLM".
  // Let's implement a soft keyword check: pass to LLM if (Score > X AND Rank < Y).
  // The "Keywords matched" field in the user message suggests the LLM uses that info.
  // If I filter out everything that doesn't match a keyword, the LLM is just a fancy "save_story" caller for keyword matches.
  // Let's stick to Score and Rank as hard filters. Keyword presence will be passed to LLM.
  // Wait, "Pre-filter stories in code using... Keyword presence" might mean "If it has a keyword, it passes the pre-filter regardless of score?" 
  // OR "It must match a keyword to be sent to LLM".
  // Given "The LLM’s job is ONLY to decide: relevant or not relevant", if we filter by keywords strictly, we don't need the LLM for relevance, just for "reason".
  // Let's assume the pre-filter is: (Score >= MIN AND Rank <= MAX).
  // The "Keyword presence" in the list of rules might just mean "Check for them and include them in the prompt".
  // Let's re-read: "Pre-filter stories in code using deterministic rules: ... Keyword presence".
  // I will implement: Must meet Score/Rank thresholds.
  
  const keywordsStr = matchedKeywords.length > 0 ? matchedKeywords.join(', ') : 'NONE';

  const systemPrompt = `You are a relevance filter for Hacker News stories.
Decide whether a news story strongly matches the user's interests.
You MUST NOT assign numeric scores.
You MUST NOT rank or compare stories.
If relevant, CALL save_story with a one-sentence reason.
If not relevant, respond with the single word IGNORE.
No other output is allowed.`;

  const userMessage = `Title: ${story.title}
HN Score: ${story.score}
Rank: ${story.rank}
Keywords matched: ${keywordsStr}`;

  const payload = {
    model: OLLAMA_MODEL,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userMessage }
    ],
    stream: false,
    tools: [
      {
        type: 'function',
        function: {
          name: 'save_story',
          description: 'Save a relevant story to the database',
          parameters: {
            type: 'object',
            properties: {
              reason: {
                type: 'string',
                description: 'The reason why this story is relevant to the user interests',
              },
            },
            required: ['reason'],
          },
        },
      },
    ],
  };

  try {
    const response = await axios.post(`${OLLAMA_BASE_URL}/api/chat`, payload);
    const message = response.data.message;

    if (message.tool_calls && message.tool_calls.length > 0) {
      const toolCall = message.tool_calls[0];
      if (toolCall.function.name === 'save_story') {
        const args = toolCall.function.arguments;
        return {
          reason: args.reason
        }; 
      }
    }

    const content = message.content.trim();
    if (content === 'IGNORE') {
      return null;
    }
    
    // Fallback if LLM talks without calling tool or saying IGNORE (treat as ignore)
    return null;

  } catch (error) {
    console.error(`Error checking relevance for story "${story.title}":`, error);
    throw error;
  }
}
