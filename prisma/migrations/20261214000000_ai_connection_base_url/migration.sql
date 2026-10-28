-- AlterTable: where a workspace's AI provider lives (Ollama / OpenAI-compatible servers).
ALTER TABLE "ai_connections" ADD COLUMN "baseUrl" TEXT;
