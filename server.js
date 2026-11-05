import express from "express";
import cors from "cors";
import path from "node:path";
import { fileURLToPath } from "node:url";
import crypto from "node:crypto";

import { GoogleGenAI } from "@google/genai";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json({ limit: "25mb" }));

// Serve three.js module & addons to browser
app.use("/three", express.static(path.join(__dirname, "node_modules", "three")));

// In-memory users matching Java ApiController
const users = {
  planner: { password: "planner123", role: "PLANNER" },
  layout: { password: "layout123", role: "LAYOUT" },
  constructor: { password: "constructor123", role: "CONSTRUCTOR" }
};

function generateBoundary(lat, lng, areaKm2) {
  const sideKm = Math.sqrt(areaKm2 || 1);
  const halfLat = (sideKm / 2) / 110.574;
  const halfLng = (sideKm / 2) / (111.320 * Math.cos((lat || 16) * Math.PI / 180));
  return [
    [Number((lat + halfLat).toFixed(6)), Number((lng - halfLng).toFixed(6))],
    [Number((lat + halfLat).toFixed(6)), Number((lng + halfLng).toFixed(6))],
    [Number((lat - halfLat).toFixed(6)), Number((lng + halfLng).toFixed(6))],
    [Number((lat - halfLat).toFixed(6)), Number((lng - halfLng).toFixed(6))]
  ];
}

// In-memory data store initialized with SeedData
let sites = [
  {
    id: 1,
    name: "Amaravati Smart Growth Zone",
    city: "Amaravati",
    state: "Andhra Pradesh",
    description: "Large urban expansion candidate for sustainable mixed-use planning.",
    terrain: "Flat alluvial",
    surrounding: "Road network, river influence, developing urban context",
    latitude: 16.5739,
    longitude: 80.3575,
    areaKm2: 1.20,
    transport: 90,
    infrastructure: 85,
    landSuitability: 92,
    boundary: [
      [16.5795, 80.3510],
      [16.5810, 80.3640],
      [16.5710, 80.3670],
      [16.5665, 80.3540]
    ]
  },
  {
    id: 2,
    name: "Visakhapatnam Urban Renewal Zone",
    city: "Visakhapatnam",
    state: "Andhra Pradesh",
    description: "Urban redevelopment candidate with strong transport connectivity.",
    terrain: "Coastal rolling",
    surrounding: "Dense urban surroundings, major roads and public transport",
    latitude: 17.6868,
    longitude: 83.2185,
    areaKm2: 1.50,
    transport: 94,
    infrastructure: 91,
    landSuitability: 84,
    boundary: [
      [17.6930, 83.2110],
      [17.6945, 83.2260],
      [17.6820, 83.2275],
      [17.6790, 83.2140]
    ]
  }
];
let nextSiteId = 3;

function calcEfficiency(l) {
  // Transparent SIH prototype score, not an Autodesk-certified metric.
  return Math.round((
    (l.sunlight || 0) * 0.15 +
    (l.daylight || 0) * 0.15 +
    (l.wind || 0) * 0.12 +
    (l.noise || 0) * 0.08 +
    (l.solar || 0) * 0.15 +
    (l.carbon || 0) * 0.15 +
    (l.terrain || 0) * 0.10 +
    (l.roads || 0) * 0.04 +
    (l.transport || 0) * 0.04 +
    (l.landscaping || 0) * 0.02
  ) * 100.0) / 100.0;
}

let layouts = [
  {
    id: 1,
    name: "Eco Grid",
    siteName: "Amaravati Smart Growth Zone",
    description: "Solar-first mixed-use grid with green corridors.",
    siteAreaKm2: 1.20,
    sunlight: 92,
    daylight: 90,
    wind: 86,
    noise: 82,
    solar: 95,
    carbon: 91,
    terrain: 94,
    roads: 90,
    transport: 91,
    landscaping: 96
  },
  {
    id: 2,
    name: "Transit Core",
    siteName: "Visakhapatnam Urban Renewal Zone",
    description: "Transit-oriented compact plan with pedestrian streets.",
    siteAreaKm2: 1.50,
    sunlight: 84,
    daylight: 89,
    wind: 90,
    noise: 78,
    solar: 88,
    carbon: 86,
    terrain: 82,
    roads: 96,
    transport: 97,
    landscaping: 88
  },
  {
    id: 3,
    name: "Climate Loop",
    siteName: "Amaravati Smart Growth Zone",
    description: "Loop road, shaded public realm and distributed green spaces.",
    siteAreaKm2: 1.20,
    sunlight: 89,
    daylight: 94,
    wind: 92,
    noise: 90,
    solar: 91,
    carbon: 94,
    terrain: 91,
    roads: 92,
    transport: 89,
    landscaping: 95
  }
];
let nextLayoutId = 4;

function formatLayout(l) {
  return {
    id: l.id,
    name: l.name,
    siteName: l.siteName,
    description: l.description,
    siteAreaKm2: l.siteAreaKm2,
    efficiency: calcEfficiency(l),
    metrics: {
      sunlight: l.sunlight,
      daylight: l.daylight,
      wind: l.wind,
      noise: l.noise,
      solar: l.solar,
      carbon: l.carbon,
      terrain: l.terrain,
      roads: l.roads,
      transport: l.transport,
      landscaping: l.landscaping
    }
  };
}

// API Routes
app.post("/api/login", (req, res) => {
  const { username, password, role } = req.body || {};
  const user = users[username];
  if (!user || user.password !== password || user.role !== role) {
    return res.status(401).json({
      ok: false,
      message: "Invalid login",
      role: "",
      token: ""
    });
  }
  return res.json({
    ok: true,
    message: "Login successful",
    role: user.role,
    token: crypto.randomUUID()
  });
});

app.get("/api/sites", (req, res) => {
  res.json(sites);
});

app.post("/api/sites", (req, res) => {
  const r = req.body || {};
  const areaKm2 = Number(r.areaKm2);
  if (isNaN(areaKm2) || areaKm2 < 1) {
    return res.status(400).json({ error: "Site must be at least 1 km²." });
  }
  const lat = Number(r.latitude) || 0;
  const lng = Number(r.longitude) || 0;
  const boundary = Array.isArray(r.boundary) && r.boundary.length >= 3
    ? r.boundary
    : generateBoundary(lat, lng, areaKm2);

  const newSite = {
    id: nextSiteId++,
    name: String(r.name || ""),
    city: String(r.city || ""),
    state: String(r.state || ""),
    description: String(r.description || ""),
    terrain: String(r.terrain || ""),
    surrounding: String(r.surrounding || ""),
    latitude: lat,
    longitude: lng,
    areaKm2: areaKm2,
    transport: Number(r.transport) || 0,
    infrastructure: Number(r.infrastructure) || 0,
    landSuitability: Number(r.landSuitability) || 0,
    boundary: boundary
  };
  sites.push(newSite);
  res.json(newSite);
});

app.post("/api/sites/:id/select", (req, res) => {
  const site = sites.find(s => s.id === Number(req.params.id));
  if (!site) {
    return res.status(404).json({ error: "Site not found" });
  }
  res.json({ selectedSite: site });
});

app.get("/api/layouts", (req, res) => {
  res.json(layouts.map(formatLayout));
});

app.post("/api/layouts", (req, res) => {
  const r = req.body || {};
  const newLayout = {
    id: nextLayoutId++,
    name: String(r.name || ""),
    siteName: String(r.siteName || ""),
    description: String(r.description || ""),
    siteAreaKm2: Number(r.siteAreaKm2) || 0,
    sunlight: Number(r.sunlight) || 0,
    daylight: Number(r.daylight) || 0,
    wind: Number(r.wind) || 0,
    noise: Number(r.noise) || 0,
    solar: Number(r.solar) || 0,
    carbon: Number(r.carbon) || 0,
    terrain: Number(r.terrain) || 0,
    roads: Number(r.roads) || 0,
    transport: Number(r.transport) || 0,
    landscaping: Number(r.landscaping) || 0
  };
  layouts.push(newLayout);
  res.json(newLayout);
});

app.post("/api/layouts/:id/select", (req, res) => {
  const layout = layouts.find(l => l.id === Number(req.params.id));
  if (!layout) {
    return res.status(404).json({ error: "Layout not found" });
  }
  res.json({
    selectedLayout: layout,
    efficiency: calcEfficiency(layout)
  });
});

app.get("/api/health", (req, res) => {
  res.json({ status: "UP", service: "SIH Smart City Planner" });
});

// Google Maps Configuration for frontend client
app.get("/api/config/maps", (req, res) => {
  res.json({
    apiKey: process.env.GOOGLE_MAPS_API_KEY || process.env.VITE_GOOGLE_MAPS_API_KEY || ""
  });
});

// Gemini 3.8 Flash with Google Maps Grounding
app.post("/api/ai/maps-grounding", async (req, res) => {
  try {
    const { siteName, city, state, latitude, longitude, query } = req.body || {};
    const lat = Number(latitude) || 16.5739;
    const lng = Number(longitude) || 80.3575;
    const ai = new GoogleGenAI();
    const prompt = query || `Perform a smart-city geographic and urban infrastructure evaluation for "${siteName || 'Site'}" in ${city || 'City'}, ${state || ''} around coordinates ${lat}, ${lng}. Analyze local arterial roads, transit proximity, surrounding civic amenities, environmental context, and geographic opportunities for sustainable smart-city expansion.`;

    const response = await ai.models.generateContent({
      model: "gemini-3.8-flash",
      contents: prompt,
      config: {
        tools: [{ googleMaps: {} }],
        toolConfig: {
          retrievalConfig: {
            latLng: {
              latitude: lat,
              longitude: lng
            }
          }
        }
      }
    });

    const text = response.text || "No analysis generated.";
    const groundingChunks = response.candidates?.[0]?.groundingMetadata?.groundingChunks || [];

    res.json({
      text,
      groundingChunks
    });
  } catch (err) {
    console.error("Maps Grounding Error:", err);
    res.status(500).json({
      error: err.message || "Failed to generate Google Maps grounded analysis"
    });
  }
});

// Create & edit images using gemini-nano-banana-2.1
app.post("/api/ai/generate-image", async (req, res) => {
  try {
    const { prompt, baseImage, aspectRatio } = req.body || {};
    if (!prompt) return res.status(400).json({ error: "Prompt is required." });
    const ai = new GoogleGenAI();

    const parts = [];
    if (baseImage) {
      const cleanBase64 = baseImage.replace(/^data:image\/[a-z]+;base64,/, "");
      parts.push({
        inlineData: {
          mimeType: "image/png",
          data: cleanBase64
        }
      });
    }
    parts.push({ text: prompt });

    const response = await ai.models.generateContent({
      model: "gemini-nano-banana-2.1",
      contents: { parts },
      config: {
        imageConfig: {
          aspectRatio: aspectRatio || "16:9"
        }
      }
    });

    let imageUrl = null;
    for (const part of response.candidates?.[0]?.content?.parts || []) {
      if (part.inlineData) {
        imageUrl = `data:${part.inlineData.mimeType};base64,${part.inlineData.data}`;
        break;
      }
    }

    res.json({
      imageUrl,
      text: response.text || "Image processed successfully."
    });
  } catch (err) {
    console.error("Generate image error:", err);
    res.status(500).json({
      error: err.message || "Failed to generate image. Note: gemini-nano-banana-2.1 requires an active paid API key."
    });
  }
});

// Animate images into video using Interactions API with gemini-omni-1.1-flash
app.post("/api/ai/animate-video", async (req, res) => {
  try {
    const { prompt, imageBase64, aspectRatio } = req.body || {};
    if (!imageBase64) return res.status(400).json({ error: "Image is required to animate." });
    const ai = new GoogleGenAI();

    const cleanBase64 = imageBase64.replace(/^data:image\/[a-z]+;base64,/, "");
    const targetAspect = (aspectRatio === "9:16") ? "9:16" : "16:9";

    const response = await ai.interactions.generate({
      model: "gemini-omni-1.1-flash",
      input: [
        {
          role: "user",
          content: [
            {
              type: "image",
              data: cleanBase64,
              mimeType: "image/png"
            },
            {
              type: "text",
              text: prompt || "Animate this smart-city urban architectural concept with smooth cinematic drone fly-through, moving traffic on roadways, and realistic sunlight shifts."
            }
          ]
        }
      ],
      options: {
        aspectRatio: targetAspect
      }
    });

    res.json({ result: response });
  } catch (err) {
    console.error("Video animation error:", err);
    res.status(500).json({
      error: err.message || "Failed to generate video. Note: gemini-omni-1.1-flash requires an active paid API key."
    });
  }
});

// Serve static frontend assets
app.use(express.static(path.join(__dirname, "public")));

// Fallback to index.html for any unmatched client route
app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`Server listening on http://0.0.0.0:${PORT}`);
});
