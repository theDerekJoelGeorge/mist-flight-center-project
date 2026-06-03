export interface Restaurant {
  id: string;
  name: string;
  cuisine: string;
  rating: number;
  userRatingCount: number;
  address: string;
  isOpen: boolean;
  openNowText: string;
  editorialSummary: string;
  priceLevel: number;
  types: string[];
  distance: number;
  location: { lat: number; lng: number };
  photos: { name?: string }[];
  reviews: any[];
  whyThis?: string;
  serviceAttitude?: "ATTENTIVE" | "STANDARD" | "UNKNOWN";
}

export interface MoodContext {
  mood: "comfort" | "new" | "light" | "indulgent" | "";
  occasion: "solo" | "someone" | "group" | "";
  budget: "cheap" | "midrange" | "treat" | "";
}

export interface SwipeItem {
  placeId: string;
  name: string;
  direction: "left" | "right";
  context: MoodContext;
  timestamp: number;
  cuisineType: string;
  priceLevel: number;
}

export interface UserProfile {
  swipeHistory: SwipeItem[];
  lastContext: MoodContext | null;
  sessionCount: number;
}
