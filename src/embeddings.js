import OpenAI from "openai";
import { config } from "./config.js";

const openai = new OpenAI({ apiKey: config.openaiApiKey });

export async function createEmbedding(input) {
  const response = await openai.embeddings.create({
    model: config.embeddingModel,
    input,
    encoding_format: "float"
  });

  return response.data[0].embedding;
}

export async function createEmbeddings(inputs) {
  if (inputs.length === 0) return [];

  const response = await openai.embeddings.create({
    model: config.embeddingModel,
    input: inputs,
    encoding_format: "float"
  });

  return response.data
    .sort((a, b) => a.index - b.index)
    .map((item) => item.embedding);
}
