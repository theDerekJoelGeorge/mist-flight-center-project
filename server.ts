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

const isGoogleMapsKeyValid = (): boolean => {
  const key = getGoogleMapsApiKey();
  return Boolean(key && key.trim() !== "" && key !== "MY_GOOGLE_MAPS_PLATFORM_KEY" && !key.startsWith("MY_"));
};

const isGeminiKeyValid = (): boolean => {
  const key = getGeminiApiKey();
  return Boolean(key && key.trim() !== "" && key !== "MY_GEMINI_API_KEY" && !key.startsWith("MY_"));
};

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
  const hasGemini = isGeminiKeyValid();
  const hasGoogleMaps = isGoogleMapsKeyValid();
  res.json({
    configured: true,
    hasGemini,
    hasGoogleMaps,
  });
});

function getUnsplashPhotoUrl(cuisine: string): string {
  const c = cuisine.toLowerCase();
  if (c.includes("ramen")) return "https://images.unsplash.com/photo-1569718212165-3a8278d5f624?q=80&w=600&auto=format&fit=crop";
  if (c.includes("sushi") || c.includes("japanese")) return "https://images.unsplash.com/photo-1579871494447-9811cf80d66c?q=80&w=600&auto=format&fit=crop";
  if (c.includes("italian") || c.includes("pasta") || c.includes("pizza")) return "https://images.unsplash.com/photo-1546549032-9571cd6b27df?q=80&w=600&auto=format&fit=crop";
  if (c.includes("french") || c.includes("steak") || c.includes("bistro")) return "https://images.unsplash.com/photo-1600891964599-f61ba0e24092?q=80&w=600&auto=format&fit=crop";
  if (c.includes("salad") || c.includes("mediterranean") || c.includes("vegetarian")) return "https://images.unsplash.com/photo-1512621776951-a57141f2eefd?q=80&w=600&auto=format&fit=crop";
  if (c.includes("mexican") || c.includes("tacos")) return "https://images.unsplash.com/photo-1565299585323-38d6b0865b47?q=80&w=600&auto=format&fit=crop";
  if (c.includes("korean") || c.includes("bbq") || c.includes("barbecue")) return "https://images.unsplash.com/photo-1598411037853-eb3788223c6c?q=80&w=600&auto=format&fit=crop";
  if (c.includes("chinese") || c.includes("dim sum")) return "https://images.unsplash.com/photo-1563245372-f21724e3856d?q=80&w=600&auto=format&fit=crop";
  if (c.includes("indian") || c.includes("curry") || c.includes("saffron")) return "https://images.unsplash.com/photo-1585938338392-50a59970d2ee?q=80&w=600&auto=format&fit=crop";
  return "https://images.unsplash.com/photo-1504674900247-0877df9cc836?q=80&w=600&auto=format&fit=crop";
}

// 2. API - Static Map secure proxy
app.get("/api/staticmap", async (req, res) => {
  try {
    const lat = req.query.lat;
    const lng = req.query.lng;
    
    if (!isGoogleMapsKeyValid()) {
      res.setHeader("Content-Type", "image/svg+xml");
      return res.send(`
        <svg width="600" height="240" viewBox="0 0 600 240" xmlns="http://www.w3.org/2000/svg">
          <rect width="600" height="240" fill="#141414"/>
          <g stroke="#2A2A2A" stroke-width="1">
            <line x1="0" y1="40" x2="600" y2="40"/>
            <line x1="0" y1="100" x2="600" y2="100"/>
            <line x1="0" y1="160" x2="600" y2="160"/>
            <line x1="0" y1="200" x2="600" y2="200"/>
            <line x1="100" y1="0" x2="100" y2="240"/>
            <line x1="250" y1="0" x2="250" y2="240"/>
            <line x1="420" y1="0" x2="420" y2="240"/>
          </g>
          <circle cx="300" cy="120" r="10" fill="#C8714A" fill-opacity="0.3"/>
          <circle cx="300" cy="120" r="4" fill="#C8714A"/>
          <text x="315" y="125" fill="#9A9488" font-family="sans-serif" font-size="12">Pins nearby (Demo)</text>
        </svg>
      `);
    }

    const key = getGoogleMapsApiKey();
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
    if (!name) {
      return res.status(400).json({ error: "Photo reference name is required" });
    }

    if (!isGoogleMapsKeyValid() || name.startsWith("dummy-")) {
      const cuisine = name.replace("dummy-", "");
      const fallbackUrl = getUnsplashPhotoUrl(cuisine);
      const foodResponse = await fetch(fallbackUrl);
      if (foodResponse.ok) {
        const contentType = foodResponse.headers.get("content-type") || "image/jpeg";
        res.setHeader("Content-Type", contentType);
        const arrayBuffer = await foodResponse.arrayBuffer();
        return res.send(Buffer.from(arrayBuffer));
      }
      return res.status(404).json({ error: "Fallback image not found" });
    }

    const key = getGoogleMapsApiKey();
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

function getMockPlaces() {
  return [
    {
      id: "dummy-1",
      displayName: { text: "L'Avenue Bis" },
      rating: 4.8,
      userRatingCount: 342,
      priceLevel: 3,
      formattedAddress: "24 Rue de la Paix, Paris",
      currentOpeningHours: { openNow: true },
      photos: [{ name: "dummy-bistro" }],
      reviews: [
        { text: { text: "Exquisite steak frites. The service was beautifully attentive and classy." }, authorAttribution: { displayName: "Arthur" } }
      ],
      editorialSummary: { text: "An intimate, candle-lit bistro serving refined Parisian comfort food with exceptional wine pairings." },
      primaryTypeDisplayName: { text: "French Bistro" },
      types: ["restaurant", "french_restaurant", "fine_dining_restaurant"],
      location: { latitude: 48.8690, longitude: 2.3300 }
    },
    {
      id: "dummy-2",
      displayName: { text: "Osteria L'Angolo" },
      rating: 4.7,
      userRatingCount: 512,
      priceLevel: 2,
      formattedAddress: "12 Via dei Condotti, Rome",
      currentOpeningHours: { openNow: true },
      photos: [{ name: "dummy-italian" }],
      reviews: [
        { text: { text: "Best cacio e pepe in the neighborhood! Friendly owners who treat you like family." }, authorAttribution: { displayName: "Arthur" } }
      ],
      editorialSummary: { text: "A warm, family-run corner tavern offering handmade pastas, slow-cooked ragus, and freshly baked focaccia." },
      primaryTypeDisplayName: { text: "Italian Tavern" },
      types: ["restaurant", "italian_restaurant"],
      location: { latitude: 41.9056, longitude: 12.4823 }
    },
    {
      id: "dummy-3",
      displayName: { text: "Midori Zen" },
      rating: 4.9,
      userRatingCount: 189,
      priceLevel: 4,
      formattedAddress: "3-5 Ginza, Chuo, Tokyo",
      currentOpeningHours: { openNow: true },
      photos: [{ name: "dummy-japanese" }],
      reviews: [
        { text: { text: "Stunning seasonal omakase. Meticulous execution by Chef Akira." }, authorAttribution: { displayName: "Akira" } }
      ],
      editorialSummary: { text: "A serene, minimalist sushi counter committed to seasonal hyper-fresh fish and meticulous craftsmanship." },
      primaryTypeDisplayName: { text: "Japanese Sushi" },
      types: ["restaurant", "sushi_restaurant", "japanese_restaurant"],
      location: { latitude: 35.6724, longitude: 139.7640 }
    },
    {
      id: "dummy-4",
      displayName: { text: "The Green Leaf" },
      rating: 4.6,
      userRatingCount: 220,
      priceLevel: 1,
      formattedAddress: "88 Melrose Ave, Los Angeles",
      currentOpeningHours: { openNow: true },
      photos: [{ name: "dummy-salad" }],
      reviews: [
        { text: { text: "Super fresh, nutritious, and absolutely packed with bold zesty flavors!" }, authorAttribution: { displayName: "John" } }
      ],
      editorialSummary: { text: "A vibrant, airy space dedicated to light, nourishing seasonal bowls, house-pressed juices, and fresh falafel." },
      primaryTypeDisplayName: { text: "Mediterranean Salad Bar" },
      types: ["salad_shop", "mediterranean_restaurant", "vegetarian_restaurant", "restaurant"],
      location: { latitude: 34.0837, longitude: -118.3618 }
    },
    {
      id: "dummy-5",
      displayName: { text: "Ramen Ichiraku" },
      rating: 4.6,
      userRatingCount: 852,
      priceLevel: 1,
      formattedAddress: "712 Broadway, New York",
      currentOpeningHours: { openNow: true },
      photos: [{ name: "dummy-ramen" }],
      reviews: [
        { text: { text: "Ultimate comfort bowls with deeply seasoned pork belly and soft eggs." }, authorAttribution: { displayName: "Jane" } }
      ],
      editorialSummary: { text: "A lively, sub-level ramen den serving rich, 24-hour tonkotsu broths and springy handmade noodles." },
      primaryTypeDisplayName: { text: "Japanese Ramen" },
      types: ["restaurant", "ramen_restaurant", "japanese_restaurant"],
      location: { latitude: 40.7306, longitude: -73.9924 }
    },
    {
      id: "dummy-6",
      displayName: { text: "Taqueria Sonora" },
      rating: 4.8,
      userRatingCount: 412,
      priceLevel: 1,
      formattedAddress: "1402 Congress Ave, Austin",
      currentOpeningHours: { openNow: true },
      photos: [{ name: "dummy-mexican" }],
      reviews: [
        { text: { text: "Outstanding carne asada! Quick, friendly, and deeply flavorful tacos." }, authorAttribution: { displayName: "Bob" } }
      ],
      editorialSummary: { text: "An unpretentious brick-and-mortar storefront churning out award-winning hand-pressed corn tortilla tacos and fiery salsas." },
      primaryTypeDisplayName: { text: "Mexican Street Food" },
      types: ["restaurant", "mexican_restaurant"],
      location: { latitude: 30.2747, longitude: -97.7404 }
    },
    {
      id: "dummy-7",
      displayName: { text: "Seoul Q Barbecue" },
      rating: 4.7,
      userRatingCount: 389,
      priceLevel: 3,
      formattedAddress: "512 W 32nd St, New York",
      currentOpeningHours: { openNow: true },
      photos: [{ name: "dummy-korean" }],
      reviews: [
        { text: { text: "Insanely delicious short ribs and incredibly helpful, friendly grilling service." }, authorAttribution: { displayName: "Charlie" } }
      ],
      editorialSummary: { text: "A buzzy, smoke-free tabletop barbecue destination famous for prime aged cuts and an exquisite array of traditional banchan." },
      primaryTypeDisplayName: { text: "Korean BBQ" },
      types: ["restaurant", "korean_restaurant"],
      location: { latitude: 40.7484, longitude: -73.9857 }
    },
    {
      id: "dummy-8",
      displayName: { text: "The Capital Club" },
      rating: 4.8,
      userRatingCount: 654,
      priceLevel: 4,
      formattedAddress: "300 California St, San Francisco",
      currentOpeningHours: { openNow: true },
      photos: [{ name: "dummy-steak" }],
      reviews: [
        { text: { text: "Magnificent marble ribeye, superb wine cellar, and timeless professional waitstaff." }, authorAttribution: { displayName: "David" } }
      ],
      editorialSummary: { text: "An opulent, dark-wood mahogany lounge specializing in prime dry-aged bone-in ribeyes, classic martinis, and old-school hospitality." },
      primaryTypeDisplayName: { text: "Steakhouse & Grill" },
      types: ["restaurant", "steak_house", "fine_dining_restaurant"],
      location: { latitude: 37.7937, longitude: -122.4011 }
    },
    {
      id: "dummy-9",
      displayName: { text: "Lotus Blossom" },
      rating: 4.5,
      userRatingCount: 298,
      priceLevel: 2,
      formattedAddress: "45 Chinatown Walk, Vancouver",
      currentOpeningHours: { openNow: true },
      photos: [{ name: "dummy-chinese" }],
      reviews: [
        { text: { text: "Sensational soup dumplings and quick turn-around service." }, authorAttribution: { displayName: "Emily" } }
      ],
      editorialSummary: { text: "A classic dim sum parlour beloved for steaming baskets of baskets, roasted duck, and bustling energy." },
      primaryTypeDisplayName: { text: "Chinese Dim Sum" },
      types: ["restaurant", "chinese_restaurant"],
      location: { latitude: 49.2827, longitude: -123.1207 }
    },
    {
      id: "dummy-10",
      displayName: { text: "Saffron Garden" },
      rating: 4.7,
      userRatingCount: 310,
      priceLevel: 2,
      formattedAddress: "89 Brick Lane, London",
      currentOpeningHours: { openNow: true },
      photos: [{ name: "dummy-indian" }],
      reviews: [
        { text: { text: "Stunning clay-oven chicken tikka and incredibly fluffy garlic naans." }, authorAttribution: { displayName: "James" } }
      ],
      editorialSummary: { text: "An elegant, contemporary dining room highlighting traditional spice blending and authentic clay-oven specialties." },
      primaryTypeDisplayName: { text: "Indian Curry House" },
      types: ["restaurant", "indian_restaurant"],
      location: { latitude: 51.5218, longitude: -0.0718 }
    },
    {
      id: "dummy-11",
      displayName: { text: "Bosphorus Grill" },
      rating: 4.6,
      userRatingCount: 175,
      priceLevel: 1,
      formattedAddress: "16 Berlin Strasse, Berlin",
      currentOpeningHours: { openNow: true },
      photos: [{ name: "dummy-mediterranean" }],
      reviews: [
        { text: { text: "Flawless juicy kebabs and perfectly spiced hot dips with puff bread." }, authorAttribution: { displayName: "Lukas" } }
      ],
      editorialSummary: { text: "A buzzing, bright canteen turning out charcoal-grilled Turkish favorites, fresh pides, and refreshing ayran." },
      primaryTypeDisplayName: { text: "Turkish Charcoal Grill" },
      types: ["restaurant", "turkish_restaurant", "mediterranean_restaurant"],
      location: { latitude: 52.5200, longitude: 13.4050 }
    },
    {
      id: "dummy-12",
      displayName: { text: "Pho Viet" },
      rating: 4.7,
      userRatingCount: 420,
      priceLevel: 1,
      formattedAddress: "68 Kingsland Rd, London",
      currentOpeningHours: { openNow: true },
      photos: [{ name: "dummy-soup" }],
      reviews: [
        { text: { text: "Glorious, nourishing beef bone marrow broth with silky soft noodles." }, authorAttribution: { displayName: "Tuan" } }
      ],
      editorialSummary: { text: "A humble, crowded kitchen famous for steaming aromatic bowls of traditional pho and crispy spring rolls." },
      primaryTypeDisplayName: { text: "Vietnamese Noodle Bar" },
      types: ["restaurant", "vietnamese_restaurant"],
      location: { latitude: 51.5300, longitude: -0.0780 }
    }
  ];
}

// 4. API - Recommendations and Ranking Engine
app.post("/api/recommendations", async (req, res) => {
  try {
    const { mood, occasion, budget, lat, lng, cuisineLikes, recentDislikes } = req.body;

    // Default coordinates if geolocation is not shared
    const searchLat = lat || 40.7128; // New York
    const searchLng = lng || -74.006;

    let RawPlaces = [];

    if (!isGoogleMapsKeyValid()) {
      RawPlaces = getMockPlaces();
    } else {
      const apiKey = getGoogleMapsApiKey();
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
      RawPlaces = data.places || [];
    }

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
    const geminiSupported = isGeminiKeyValid();
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
