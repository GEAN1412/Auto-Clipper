import { GoogleGenAI, Type } from "@google/genai";

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || "" });

export interface Subtitle {
  start: number;
  end: number;
  text: string;
}

export async function generateSubtitles(videoBase64: string, mimeType: string): Promise<Subtitle[]> {
  const response = await ai.models.generateContent({
    model: "gemini-3-flash-preview",
    contents: [
      {
        parts: [
          {
            inlineData: {
              data: videoBase64,
              mimeType: mimeType,
            },
          },
          {
            text: "Transcribe this video and provide subtitles with start and end timestamps in seconds. Return the result as a JSON array of objects with 'start', 'end', and 'text' properties.",
          },
        ],
      },
    ],
    config: {
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.ARRAY,
        items: {
          type: Type.OBJECT,
          properties: {
            start: { type: Type.NUMBER },
            end: { type: Type.NUMBER },
            text: { type: Type.STRING },
          },
          required: ["start", "end", "text"],
        },
      },
    },
  });

  try {
    const text = response.text;
    if (!text) return [];
    return JSON.parse(text);
  } catch (error) {
    console.error("Error parsing subtitles:", error);
    return [];
  }
}
