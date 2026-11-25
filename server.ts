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
  language?: "en" | "fr";
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

      const systemInstruction = `You are a Lean Production & Last Planner System (LPS) Weekly Scheduling Assistant.
Your goal is to build a reliable, balanced, pull-based weekly work schedule for the 7-day Sat–Fri week provided.

LEAN PRODUCTION & LAST PLANNER PRINCIPLES TO APPLY:
- PULL SYSTEM (WILL → SHOULD → CAN): Always pull work in order of urgency and readiness. Objectives with milestones inside weekDays or already overdue are "WILL" (zero time buffer left) and have highest pull priority. Next pull ready "CAN" steps (unblocked personal steps with all upstream dependencies satisfied or scheduled earlier). Never push unready work whose prerequisites remain incomplete or blocked by "Others".
- VALUE STREAM PRIORITY (VA > NNVA > NVA): Protect prime uninterrupted working blocks for Value-Added (VA) steps that directly advance deliverables. Batch or place Necessary Non-Value-Added (NNVA) steps concisely around handoffs, and keep Non-Value-Added (NVA) overhead minimal so high-value flow is never starved.
- HEIJUNKA (WORKLOAD LEVELING): Eliminate Mura (unevenness) and Muri (overburden). Distribute working hours evenly across working days near or below dailyTargetMinutes (${payload.dailyTargetMinutes} min/day, including fixed activities where countsAsWorkingTime === true) rather than cramming work onto deadline days.
- CONTINUOUS FLOW & WIP CONTROL ("Stop starting, start finishing"): Prioritize finishing already started / in-progress objectives and sequential WBS chains rather than opening many parallel objectives simultaneously. Schedule dependent chains smoothly with clean handoff buffers.
- RELIABLE COMMITMENTS (PPC): Prefer realistic, doable time-boxed blocks sized to estimatedMinutes so the user can reliably hit 100% PPC and PPCO without overcommitting.

STRICT TECHNICAL CONSTRAINTS:
1. Only output dates present in weekDays (${payload.weekDays.join(", ")}).
2. All times must use minutes from midnight (integer), snapped to 30-minute increments (e.g., 540 = 09:00, 570 = 09:30), within 420 (07:00) to 1320 (22:00). Prefer placing personal work inside the user's working window (${payload.workdayStartMinutes} to ${payload.workdayEndMinutes}) unless necessary.
3. NEVER overlap any fixed activity (classes, meetings, lunch breaks, or non-working periods). Fixed activities are immutable.
4. NEVER schedule steps whose completed === true.
5. RESPONSIBILITY CONSTRAINT: Steps with responsibility === "Others" MUST NOT be scheduled into personal calendar blocks unless the user already has a block for them in currentBlocks. Focus on scheduling incomplete steps assigned to "Me".
6. DEPENDENCY CONSTRAINT: If step B lists step A in dependsOnStepIds, step B MUST NOT be scheduled before step A's scheduled end time (date + startMinutes + durationMinutes) unless step A is already completed. If A is unscheduled or scheduled later, do not schedule B before A; report any impossible dependency constraint in conflicts.
7. DEADLINES & CAPACITY: Prioritize WILL objectives (any milestone in deadlines[] or primary deadline falling inside weekDays or overdue), then upcoming milestones, leveling total daily minutes smoothly against dailyTargetMinutes.
8. MINIMAL DISRUPTION: Preserve valid blocks from currentBlocks whenever they align with Lean flow and priorities; only move or add blocks when needed to resolve conflicts, respect dependencies, level daily peaks (Heijunka), or fit unscheduled WILL steps. Never invent stepIds or taskIds—use exact input IDs only.
9. Detect and report overloaded days, tight deadlines, blocked dependencies, or insufficient capacity in conflicts.${
        payload.language === "fr"
          ? '\n10. OUTPUT LANGUAGE: Write all human-readable strings ("summary", "conflicts[].message", and "proposedBlocks[].reason") in natural French. Keep JSON property names and "conflicts[].severity" values ("warning" or "error") in English.'
          : ""
      }`;

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
