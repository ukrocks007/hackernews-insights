import axios from 'axios';
import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';
import { ScrapedStory } from './hnScraper';

dotenv.config();

const OLLAMA_BASE_URL = process.env.OLLAMA_BASE_URL || 'http://localhost:11434';
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || 'functiongemma';

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

export async function checkRelevance(story: ScrapedStory): Promise<{ reason: string; score: number } | null> {
  const interests = getInterests();
  const interestsStr = interests.join(', ');

  const systemPrompt = `You are a content relevance filter. Decide if the news item matches the user’s interests. If relevant, call save_story with a reason and a relevance score (1-10). Otherwise respond with IGNORE.

User Interests: ${interestsStr}
`;

  const userMessage = `Story Title: ${story.title}
URL: ${story.url}
Score: ${story.score}
Rank: ${story.rank}
`;

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
              score: {
                type: 'integer',
                description: 'Relevance score from 1 (low) to 10 (high)',
              },
            },
            required: ['reason', 'score'],
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
          reason: args.reason,
          score: typeof args.score === 'number' ? args.score : 5 // Default to 5 if missing
        }; 
      }
    }

    const content = message.content.trim();
    if (content === 'IGNORE') {
      return null;
    }
    
    return null;

  } catch (error) {
    console.error(`Error checking relevance for story "${story.title}":`, error);
    throw error;
  }
}
