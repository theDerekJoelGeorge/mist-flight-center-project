import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";
import { GoogleGenAI } from "@google/genai";

const app = express();
const PORT = 3000;

app.use(express.json());

// Helper to check and get keys
const getGeminiApiKey = () => process.env.GEMINI_API_KEY || "";
const getGoogleMapsApiKey = () => process.env.GOOGLE_MAPS_PLATFORM_KEY || "";

// Lazy initialized Gemini client
let aiClient: GoogleGenAI | null = null;
function getGeminiClient() {
  const apiKey = getGeminiApiKey();
  if (!apiKey) {
    throw new Error("GEMINI_API_KEY environment variable is not defined.");
  }
  if (!aiClient) {
    aiClient = new GoogleGenAI({
      apiKey,
      httpOptions: {
        headers: {
          "User-Agent": "aistudio-build",
        },
      },
    });
  }
  return aiClient;
}

// Distance calculation using Haversine formula
function calculateDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371; // Radius of the Earth in km
  const dLat = (lat2 - lat1) * (Math.PI / 180);
  const dLon = (lon2 - lon1) * (Math.PI / 180);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * (Math.PI / 180)) *
      Math.cos(lat2 * (Math.PI / 180)) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c; // Distance in km
}

// 1. API - Check Config status
app.get("/api/status", (req, res) => {
  const hasGemini = Boolean(getGeminiApiKey());
  const hasGoogleMaps = Boolean(getGoogleMapsApiKey());
  res.json({
    configured: hasGemini && hasGoogleMaps,
    hasGemini,
    hasGoogleMaps,
  });
});

// 2. API - Static Map secure proxy
app.get("/api/staticmap", async (req, res) => {
  try {
    const lat = req.query.lat;
    const lng = req.query.lng;
    const key = getGoogleMapsApiKey();
    if (!key) {
      return res.status(400).json({ error: "Google Maps Platform key is not configured" });
    }
    if (!lat || !lng) {
      return res.status(400).json({ error: "lat and lng queries are required" });
    }

    const staticMapUrl = `https://maps.googleapis.com/maps/api/staticmap?center=${lat},${lng}&zoom=15&size=600x240&markers=color:0xC8714A%7C${lat},${lng}&key=${key}`;
    const response = await fetch(staticMapUrl);
    if (!response.ok) {
      throw new Error(`Failed to fetch static map: ${response.statusText}`);
    }

    const contentType = response.headers.get("content-type") || "image/png";
    res.setHeader("Content-Type", contentType);

    const arrayBuffer = await response.arrayBuffer();
    res.send(Buffer.from(arrayBuffer));
  } catch (error: any) {
    console.error("Static map proxy error:", error);
    res.status(500).json({ error: error.message });
  }
});

// 3. API - Photo secure proxy
app.get("/api/photo", async (req, res) => {
  try {
    const name = req.query.name as string;
    const key = getGoogleMapsApiKey();
    if (!key) {
      return res.status(400).json({ error: "Google Maps Platform key is not configured" });
    }
    if (!name) {
      return res.status(400).json({ error: "Photo reference name is required" });
    }

    const photoUrl = `https://places.googleapis.com/v1/${name}/media?maxWidthPx=800&key=${key}`;
    const response = await fetch(photoUrl);
    if (!response.ok) {
      throw new Error(`Failed to fetch photo media: ${response.statusText}`);
    }

    const contentType = response.headers.get("content-type") || "image/jpeg";
    res.setHeader("Content-Type", contentType);

    const arrayBuffer = await response.arrayBuffer();
    res.send(Buffer.from(arrayBuffer));
  } catch (error: any) {
    console.error("Photo proxy error:", error);
    res.status(500).json({ error: error.message });
  }
});

// Mood to types map
const moodMap: Record<string, string[]> = {
  comfort: ["restaurant", "italian_restaurant", "chinese_restaurant", "ramen_restaurant"],
  new: ["japanese_restaurant", "thai_restaurant", "indian_restaurant", "korean_restaurant", "vietnamese_restaurant", "turkish_restaurant"],
  light: ["salad_shop", "mediterranean_restaurant", "sushi_restaurant", "vegetarian_restaurant"],
  indulgent: ["steak_house", "seafood_restaurant", "fine_dining_restaurant", "pizza_restaurant"],
};

// Budget to places price mapping
const budgetMap: Record<string, number[]> = {
  cheap: [0, 1],
  midrange: [2, 3],
  treat: [3, 4],
};

// Price Level Helper (numbers to level translation)
function getNumericPriceLevel(priceLevel: any): number {
  if (typeof priceLevel === "number") return priceLevel;
  if (typeof priceLevel === "string") {
    if (priceLevel.includes("FREE")) return 0;
    if (priceLevel.includes("INEXPENSIVE")) return 1;
    if (priceLevel.includes("MODERATE")) return 2;
    if (priceLevel.includes("EXPENSIVE") && !priceLevel.includes("VERY")) return 3;
    if (priceLevel.includes("VERY_EXPENSIVE")) return 4;
  }
  return 1; // Fallback
}

// 4. API - Recommendations and Ranking Engine
app.post("/api/recommendations", async (req, res) => {
  try {
    const { mood, occasion, budget, lat, lng, cuisineLikes, recentDislikes } = req.body;

    const apiKey = getGoogleMapsApiKey();
    if (!apiKey) {
      return res.status(400).json({ error: "Google Maps/Places API Key required." });
    }

    // Default coordinates if geolocation is not shared
    const searchLat = lat || 40.7128; // New York
    const searchLng = lng || -74.006;

    // Call Google Places (New) Nearby Search
    const placesUrl = "https://places.googleapis.com/v1/places:searchNearby";
    const headers = {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": apiKey,
      "X-Goog-FieldMask":
        "places.id,places.displayName,places.rating,places.userRatingCount,places.priceLevel,places.formattedAddress,places.currentOpeningHours,places.photos,places.reviews,places.editorialSummary,places.primaryTypeDisplayName,places.types,places.location",
    };

    const searchRadius = 4000; // 4 km radius

    const response = await fetch(placesUrl, {
      method: "POST",
      headers,
      body: JSON.stringify({
        includedTypes: ["restaurant"],
        maxResultCount: 20,
        locationRestriction: {
          circle: {
            center: { latitude: searchLat, longitude: searchLng },
            radius: searchRadius,
          },
        },
        rankPreference: "POPULARITY",
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error("Places API Failed:", errText);
      throw new Error(`Google Places API failure: ${response.statusText}`);
    }

    const data = await response.json();
    const RawPlaces = data.places || [];

    if (RawPlaces.length === 0) {
      return res.json({ restaurants: [] });
    }

    // Scoring algorithm
    const scoredPlaces = RawPlaces.map((place: any) => {
      let score = 0;

      // Rating quality
      const rating = place.rating || 0;
      const reviewCount = place.userRatingCount || 0;
      const ratingScore = (rating / 5) * 30;
      const confidenceBoost = Math.min(reviewCount / 500, 1) * 10;
      score += ratingScore + confidenceBoost;

      // Price match mapping
      const pLevel = getNumericPriceLevel(place.priceLevel);
      const allowedPrices = budgetMap[budget] || [1, 2];
      const priceMatch = allowedPrices.includes(pLevel);
      score += priceMatch ? 20 : 0;

      // Currently open
      const openNow = place.currentOpeningHours?.openNow;
      score += openNow ? 15 : -20;

      // Cuisine type match
      const targetMoodTypes = moodMap[mood] || [];
      const placeTypes = place.types || [];
      const typeMatch = targetMoodTypes.some((t) => placeTypes.includes(t));
      score += typeMatch ? 15 : 0;

      // Review feedback proxy (engaged management evidence)
      const hasResponses = place.reviews && place.reviews.length > 0;
      score += hasResponses ? 10 : 0;

      // Learning model preferences boost
      if (cuisineLikes && cuisineLikes.length > 0) {
        const placeCuisine = (place.primaryTypeDisplayName?.text || "").toLowerCase();
        const likesMatch = cuisineLikes.some((liked: string) =>
          placeCuisine.includes(liked.toLowerCase()) ||
          placeTypes.some((pt: string) => pt.toLowerCase().includes(liked.toLowerCase()))
        );
        if (likesMatch) {
          score += 8;
        }
      }

      // Penalize recently rejected places
      if (recentDislikes && recentDislikes.includes(place.id)) {
        score -= 25;
      }

      const placeLat = place.location?.latitude;
      const placeLng = place.location?.longitude;
      const distance =
        placeLat && placeLng ? calculateDistance(searchLat, searchLng, placeLat, placeLng) : 0;

      return {
        id: place.id,
        name: place.displayName?.text || "Unknown Restaurant",
        cuisine: place.primaryTypeDisplayName?.text || "Casual Dining",
        rating,
        userRatingCount: reviewCount,
        address: place.formattedAddress || "",
        isOpen: openNow || false,
        openNowText: openNow ? "Open now" : "Closed",
        editorialSummary: place.editorialSummary?.text || "",
        priceLevel: pLevel,
        types: placeTypes,
        distance,
        location: { lat: placeLat, lng: placeLng },
        photos: place.photos || [],
        reviews: place.reviews || [],
        score,
      };
    });

    // Sort descending by score and pick top 5
    scoredPlaces.sort((a: any, b: any) => b.score - a.score);
    const topRestaurants = scoredPlaces.slice(0, 5);

    // AI Enrichment for the top candidates via Gemini API in parallel!
    const geminiSupported = Boolean(getGeminiApiKey());
    let enrichedRestaurants = topRestaurants;

    if (geminiSupported) {
      try {
        const gemini = getGeminiClient();

        const promises = topRestaurants.map(async (rest: any) => {
          // A. Generate Personalised "Why this for you"
          const whyPrompt = `You are writing a single short line (max 12 words) for a restaurant recommendation app.
The user is in the mood for: ${mood}
The occasion is: ${occasion}
The restaurant is: ${rest.name}, a ${rest.cuisine} with a ${rest.rating} star rating.
${rest.editorialSummary ? `Summary: ${rest.editorialSummary}` : ""}

Write ONE short line explaining why this restaurant fits right now. 
Be specific to the mood and restaurant. Avoid generic phrases like "great choice" or "you'll love it".
Start with something evocative. No quotation marks. No full stop at the end.
Examples: "Comfort in a bowl — their ramen is the city's best kept secret"
         "Something new: bold Korean BBQ two minutes from you"
         "Unhurried Italian for a proper catch-up dinner"`;

          const whyPromise = gemini.models.generateContent({
            model: "gemini-3.5-flash",
            contents: whyPrompt,
            config: {
              systemInstruction: "You are a refined, minimal, editorial culinary critic writing short summaries.",
            },
          }).then(res => res.text?.trim().replace(/^"|"$|^'|'$/g, "").replace(/\.$/, "") || "")
            .catch(() => "Highly rated · Open now · Matches your mood");

          // B. Service Badge analysis
          // We look for replies within reviews. In places API, authors of reviews write review.text, and there might be a reply.
          // Since standard REST nearbySearch doesn't always contain an explicit 'ownerReply' subfield, we prompt Gemini
          // with review contents to identify the tone of reviews and responses.
          const reviewsSubset = rest.reviews.slice(0, 5).map((r: any) => {
            return `Review Text: "${r.text?.text || ""}" by ${r.authorAttribution?.displayName || "customer"}`;
          }).join("\n\n");

          const badgePrompt = `You are analysing reviews for ${rest.name} to assess their owner or management's customer response attitude.

Here is a subset of reviews and feedback:
${reviewsSubset || "No reviews loaded."}

Classify their management attitude as one of:
- "ATTENTIVE": responses exist, are highly personal, empathetic, specific, addressing reviewers or showing strong service care
- "STANDARD": responses exist but look simple, templated, generic, or passive
- "UNKNOWN": no owner response details found, or reviews are minimal

Return ONLY one word: ATTENTIVE, STANDARD, or UNKNOWN.`;

          const badgePromise = gemini.models.generateContent({
            model: "gemini-3.5-flash",
            contents: badgePrompt,
            config: {
              systemInstruction: "Respond with exactly one word from the choices: ATTENTIVE, STANDARD, UNKNOWN.",
            },
          }).then(res => {
            const word = res.text?.trim().toUpperCase();
            if (word?.includes("ATTENTIVE")) return "ATTENTIVE";
            if (word?.includes("STANDARD")) return "STANDARD";
            return "UNKNOWN";
          }).catch(() => "UNKNOWN");

          const [whyThis, serviceAttitude] = await Promise.all([whyPromise, badgePromise]);

          return {
            ...rest,
            whyThis,
            serviceAttitude,
          };
        });

        enrichedRestaurants = await Promise.all(promises);
      } catch (geminiErr) {
        console.error("Gemini batch enrichment failed, falling back to default styling", geminiErr);
        enrichedRestaurants = topRestaurants.map((r: any) => ({
          ...r,
          whyThis: "Highly rated · Open now · Near you",
          serviceAttitude: "UNKNOWN",
        }));
      }
    } else {
      // Offline fallback
      enrichedRestaurants = topRestaurants.map((r: any) => ({
        ...r,
        whyThis: "Highly rated · Open now · Near you",
        serviceAttitude: "UNKNOWN",
      }));
    }

    res.json({ restaurants: enrichedRestaurants });
  } catch (error: any) {
    console.error("Recommendations API error:", error);
    res.status(500).json({ error: error.message });
  }
});

// Configure Vite or Serve SPA
async function startServer() {
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
