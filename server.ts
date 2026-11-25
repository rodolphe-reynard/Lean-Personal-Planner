import "dotenv/config";
import express from "express";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { GoogleGenAI, Type } from "@google/genai";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 3000);
const isProduction = process.env.NODE_ENV === "production";

interface ScheduleRequestTask {
  id: string;
  name: string;
  deadline: string;
  deadlines?: { date: string; label?: string }[];
  status: string;
  responsibility: "Me" | "Others";
}

interface ScheduleRequestStep {
  id: string;
  taskId: string;
  title: string;
  order: number;
  estimatedMinutes: number;
  completed: boolean;
  responsibility: "Me" | "Others";
  dependsOnStepIds: string[];
  valueCategory: string;
}

interface ScheduleRequestFixed {
  id: string;
  title: string;
  kind: string;
  date: string;
  startMinutes: number;
  endMinutes: number;
  countsAsWorkingTime: boolean;
  linkedStepIds: string[];
}

interface ScheduleRequestBlock {
  id: string;
  stepId: string;
  taskId: string;
  date: string;
  startMinutes: number;
  durationMinutes: number;
}

interface ScheduleRequestPayload {
  weekStart: string;
  weekDays: string[];
  todayStr: string;
  workdayStartMinutes: number;
  workdayEndMinutes: number;
  dailyTargetMinutes: number;
  userPreference?: string;
  tasks: ScheduleRequestTask[];
  steps: ScheduleRequestStep[];
  fixedActivities: ScheduleRequestFixed[];
  currentBlocks: ScheduleRequestBlock[];
}

const ai = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY,
  httpOptions: {
    headers: {
      "User-Agent": "aistudio-build",
    },
  },
});

async function startServer() {
  const app = express();
  const httpServer = http.createServer(app);
  app.use(express.json({ limit: "2mb" }));

  app.post("/api/ai/schedule", async (req, res) => {
    try {
      if (!process.env.GEMINI_API_KEY) {
        return res.status(500).json({
          error:
            "GEMINI_API_KEY is not configured. Please add your Gemini API key in Settings > Secrets.",
        });
      }

      const payload = req.body as ScheduleRequestPayload;
      if (
        !payload ||
        !Array.isArray(payload.weekDays) ||
        payload.weekDays.length !== 7 ||
        !Array.isArray(payload.tasks) ||
        !Array.isArray(payload.steps)
      ) {
        return res.status(400).json({ error: "Invalid scheduling payload." });
      }

      const systemInstruction = `You are a Lean Production Weekly Scheduling Assistant.
Your task is to generate an optimized, conflict-free weekly work schedule proposal for the 7-day Sat–Fri week provided.

STRICT RULES YOU MUST FOLLOW:
1. Only output dates present in weekDays (${payload.weekDays.join(", ")}).
2. All times must use minutes from midnight (integer), snapped to 30-minute increments (e.g., 540 = 09:00, 570 = 09:30), within 420 (07:00) to 1320 (22:00). Prefer placing personal work inside the user's working window (${payload.workdayStartMinutes} to ${payload.workdayEndMinutes}) unless necessary.
3. NEVER overlap any fixed activity (classes, meetings, lunch breaks, or non-working periods). Fixed activities are immutable.
4. NEVER schedule steps whose completed === true.
5. RESPONSIBILITY CONSTRAINT: Steps with responsibility === "Others" MUST NOT be scheduled into my personal calendar blocks unless the user already has a block for them in currentBlocks (if present in currentBlocks, preserve them or leave them to Others). Focus on scheduling incomplete steps assigned to "Me".
6. DEPENDENCY CONSTRAINT: If step B lists step A in dependsOnStepIds (or A precedes B in the same task's sequence and B depends on A), step B MUST NOT be scheduled before step A's scheduled end time (date + startMinutes + durationMinutes) unless step A is already completed. If A is scheduled after B or unscheduled, do not schedule B before A; report any impossible dependency constraint in conflicts.
7. PRIORITY & DEADLINES: Prioritize tasks where ANY milestone in deadlines[] (or primary deadline) falls within weekDays (WILL) or is overdue, then tasks with upcoming milestones. Balance daily workload near or below dailyTargetMinutes (${payload.dailyTargetMinutes} min/day, accounting for fixed activities where countsAsWorkingTime === true).
8. MINIMAL DISRUPTION: Preserve existing valid blocks from currentBlocks whenever possible, only moving or adding blocks when needed to resolve conflicts, respect dependencies, or fit unscheduled high-priority steps. Do not invent stepIds or taskIds—only use exact IDs from the input.
9. Detect and report any overloaded days, tight deadlines, blocked dependencies, or insufficient capacity in the conflicts array.`;

      const prompt = JSON.stringify(
        {
          weekStart: payload.weekStart,
          weekDays: payload.weekDays,
          todayStr: payload.todayStr,
          workdayStartMinutes: payload.workdayStartMinutes,
          workdayEndMinutes: payload.workdayEndMinutes,
          dailyTargetMinutes: payload.dailyTargetMinutes,
          userPreference: payload.userPreference || "Balance workload evenly across working days while prioritizing WILL deadlines.",
          tasks: payload.tasks,
          steps: payload.steps,
          fixedActivities: payload.fixedActivities,
          currentBlocks: payload.currentBlocks,
        },
        null,
        2
      );

      const response = await ai.models.generateContent({
        model: "gemini-4-hydrogen",
        contents: `Analyze this weekly planning context and return an optimized schedule proposal in JSON:\n${prompt}`,
        config: {
          systemInstruction,
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              summary: {
                type: Type.STRING,
                description: "Concise overview of the proposed weekly plan optimization.",
              },
              conflicts: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    severity: {
                      type: Type.STRING,
                      description: "Either 'warning' or 'error'.",
                    },
                    message: {
                      type: Type.STRING,
                      description: "Clear explanation of the conflict, overload, or dependency blocker.",
                    },
                    date: {
                      type: Type.STRING,
                      description: "Optional YYYY-MM-DD date associated with the conflict.",
                    },
                  },
                  required: ["severity", "message"],
                },
              },
              proposedBlocks: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    stepId: { type: Type.STRING },
                    taskId: { type: Type.STRING },
                    date: { type: Type.STRING, description: "YYYY-MM-DD inside weekDays" },
                    startMinutes: {
                      type: Type.INTEGER,
                      description: "Start time in minutes from midnight, multiple of 30 (420..1290)",
                    },
                    durationMinutes: {
                      type: Type.INTEGER,
                      description: "Duration in minutes, multiple of 30 (minimum 30)",
                    },
                    reason: {
                      type: Type.STRING,
                      description: "Short rationale for placing or keeping this step here.",
                    },
                  },
                  required: [
                    "stepId",
                    "taskId",
                    "date",
                    "startMinutes",
                    "durationMinutes",
                    "reason",
                  ],
                },
              },
            },
            required: ["summary", "conflicts", "proposedBlocks"],
          },
        },
      });

      const rawText = (response.text ?? "{}").trim();
      const parsed = JSON.parse(rawText);
      return res.json(parsed);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to generate AI schedule.";
      console.error("AI schedule error:", err);
      return res.status(500).json({ error: message });
    }
  });

  if (isProduction) {
    const distDir = path.resolve(__dirname, "dist");
    app.use(express.static(distDir));
    app.get("/{*path}", (_req, res) => {
      res.sendFile(path.join(distDir, "index.html"));
    });
  } else {
    const { createServer: createViteServer } = await import("vite");
    const vite = await createViteServer({
      server: {
        middlewareMode: true,
        ws: process.env.DISABLE_HMR === "true" ? false : { server: httpServer },
        hmr: process.env.DISABLE_HMR === "true" ? false : true,
      },
      appType: "spa",
    });
    if (process.env.DISABLE_HMR === "true") {
      app.get("/@vite/client", async (_req, res, next) => {
        try {
          const transformed = await vite.transformRequest("/@vite/client");
          if (transformed?.code) {
            const safeCode = transformed.code.replace(
              "transport.connect(createHMRHandler(handleMessage));",
              "/* HMR disabled: WebSocket connect skipped */"
            );
            res.type("application/javascript").send(safeCode);
            return;
          }
        } catch {
          // fall through to vite.middlewares
        }
        next();
      });
    }
    app.use(vite.middlewares);
  }

  httpServer.listen(PORT, "0.0.0.0", () => {
    console.log(`Takt server running at http://localhost:${PORT}`);
  });
}

startServer();
