import fs from "fs";
import path from "path";
import dotenv from "dotenv";
import { ScrapedStory } from "./hnScraper";
import { ContentSignals } from "./contentScraper";
import logger from "./logger";

dotenv.config();

const OLLAMA_BASE_URL = process.env.OLLAMA_BASE_URL || "http://localhost:11434";
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || "functiongemma";

// Deterministic Filters
export const MIN_HN_SCORE = 100;
export const MAX_RANK = 30;

interface InterestConfig {
  interests: string[];
}

function getInterests(): string[] {
  try {
    // Check for external config first (next to executable)
    if ((process as any).pkg) {
      const externalConfigPath = path.join(
        path.dirname(process.execPath),
        "config/interests.json",
      );
      if (fs.existsSync(externalConfigPath)) {
        const fileContent = fs.readFileSync(externalConfigPath, "utf-8");
        return JSON.parse(fileContent);
      }
    }

    // Fallback to development path or bundled path
    const configPath = path.resolve(__dirname, "../config/interests.json");
    if (fs.existsSync(configPath)) {
      const fileContent = fs.readFileSync(configPath, "utf-8");
      return JSON.parse(fileContent);
    }

    return [];
  } catch (error) {
    logger.error(`Error reading interests.json: ${error}`);
    return [];
  }
}

export async function checkRelevance(
  story: ScrapedStory,
  content: ContentSignals,
): Promise<{ reason: string } | null> {
  const interests = getInterests();

  // Note: Pre-filtering (Score/Rank) is now done in index.ts before calling this function.

  const signalsList = [
    `Page Title: ${content.pageTitle}`,
    `Description: ${content.description}`,
    `Headings: ${content.headings.join("; ")}`,
    `First Paragraphs: ${content.paragraphs.join("\n  ")}`,
    `Has Code Blocks: ${content.hasCodeBlocks}`,
    `Body Snippet: ${(content.bodyText || "").slice(0, 500)}`,
  ].join("\n- ");

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
Content signals:
- ${signalsList}`;

  const payload = {
    model: OLLAMA_MODEL,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userMessage },
    ],
    stream: false,
    tools: [
      {
        type: "function",
        function: {
          name: "save_story",
          description: "Save a relevant story to the database",
          parameters: {
            type: "object",
            properties: {
              reason: {
                type: "string",
                description:
                  "The reason why this story is relevant to the user interests",
              },
            },
            required: ["reason"],
          },
        },
      },
    ],
  };

  try {
    const response = await fetch(`${OLLAMA_BASE_URL}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      throw new Error(
        `Ollama API error: ${response.status} ${response.statusText}`,
      );
    }

    const data = await response.json();
    const message = data.message;

    if (message.tool_calls && message.tool_calls.length > 0) {
      const toolCall = message.tool_calls[0];
      if (toolCall.function.name === "save_story") {
        const args = toolCall.function.arguments;
        return {
          reason: args.reason,
        };
      }
    }

    const msgContent = message.content.trim();
    if (msgContent === "IGNORE") {
      return null;
    }

    // Fallback if LLM talks without calling tool or saying IGNORE (treat as ignore)
    return null;
  } catch (error) {
    logger.error(
      `Error checking relevance for story "${story.title}": ${error}`,
    );
    throw error;
  }
}
