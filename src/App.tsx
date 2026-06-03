import React, { useState, useEffect, useRef } from "react";
import {
  Compass,
  MapPin,
  Clock,
  ChevronRight,
  TrendingUp,
  Map as MapIcon,
  RefreshCw,
  AlertTriangle,
  ExternalLink,
  ChevronDown,
  Sparkles,
} from "lucide-react";
import { Restaurant, MoodContext, UserProfile, SwipeItem } from "./types";

// Static mapping translators for returning sessions
const PRETTY_LABELS: Record<string, string> = {
  comfort: "Comfort food",
  new: "Something new",
  light: "Light & fresh",
  indulgent: "Indulgent treat",
  solo: "Solo",
  someone: "With someone",
  group: "Group outing",
  cheap: "Keep it cheap",
  midrange: "Mid-range",
  treat: "Treat myself",
};

const SYMBOLS_MAP: Record<string, string> = {
  comfort: "🍲",
  new: "✦",
  light: "🌿",
  indulgent: "✦",
  solo: "☽",
  someone: "◎",
  group: "◈",
  cheap: "◌",
  midrange: "◎",
  treat: "◈",
};

export default function App() {
  // Navigation states: 'splash' | 'mood' | 'loading' | 'swipe' | 'empty'
  const [currentScreen, setCurrentScreen] = useState<"splash" | "mood" | "loading" | "swipe" | "empty">("splash");
  const [apiStatus, setApiStatus] = useState({ configured: true, hasGemini: true, hasGoogleMaps: true });
  
  // Geolocation states
  const [coordinates, setCoordinates] = useState<{ lat: number; lng: number } | null>(null);
  const [geoNotice, setGeoNotice] = useState<string | null>(null);

  // User Profile structure
  const [profile, setProfile] = useState<UserProfile>({
    swipeHistory: [],
    lastContext: null,
    sessionCount: 0,
  });

  // Mood question slider states
  const [questionIndex, setQuestionIndex] = useState<0 | 1 | 2>(0);
  const [context, setContext] = useState<MoodContext>({
    mood: "",
    occasion: "",
    budget: "",
  });
  const [showPrefillBanner, setShowPrefillBanner] = useState(false);

  // Loading Screen State
  const [loadingText, setLoadingText] = useState("Reading the neighbourhood…");
  
  // Card Results List
  const [restaurants, setRestaurants] = useState<Restaurant[]>([]);
  const [cardIndex, setCardIndex] = useState(0);

  // Edge flash overlay on Accept
  const [showAmberFlash, setShowAmberFlash] = useState(false);

  // Card Swipe Interactions State
  const [dragStart, setDragStart] = useState<{ x: number; y: number } | null>(null);
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });
  const [isSwiping, setIsSwiping] = useState(false);
  const [exitDirection, setExitDirection] = useState<"left" | "right" | null>(null);

  // Detail Sheet Drawer State
  const [selectedRestaurant, setSelectedRestaurant] = useState<Restaurant | null>(null);
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);

  // Initial Boot Logic
  useEffect(() => {
    // 1. Authenticate backend credentials
    fetch("/api/status")
      .then((res) => res.json())
      .then((data) => {
        setApiStatus(data);
      })
      .catch(() => {});

    // 2. Fetch browser Geolocation
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          setCoordinates({ lat: pos.coords.latitude, lng: pos.coords.longitude });
          setGeoNotice(null);
        },
        (err) => {
          console.warn("Geolocation access denied:", err);
          setGeoNotice("Using approximate location — enable GPS for better results.");
          // Fallback NYC coordinates
          setCoordinates({ lat: 40.7128, lng: -74.0060 });
        },
        { enableHighAccuracy: false, timeout: 8000, maximumAge: 300000 }
      );
    } else {
      setGeoNotice("Using approximate location — enable GPS for better results.");
      setCoordinates({ lat: 40.7128, lng: -74.0060 });
    }

    // 3. Load user model metrics
    try {
      const saved = localStorage.getItem("mise_profile");
      if (saved) {
        const parsed: UserProfile = JSON.parse(saved);
        setProfile(parsed);
        if (parsed.lastContext && parsed.lastContext.mood && parsed.sessionCount >= 3) {
          setShowPrefillBanner(true);
        }
      }
    } catch (e) {
      console.warn("Failed to retrieve profile from localStorage", e);
    }

    // 4. Progress is now governed manually by the Click to Continue button on the landing splash screen.
  }, []);

  // Cycle Loading status copy
  useEffect(() => {
    if (currentScreen !== "loading") return;

    const phrases = [
      "Reading the neighbourhood…",
      "Checking who's open now…",
      "Looking at what people are saying…",
      "Almost there…",
    ];
    let index = 0;

    const interval = setInterval(() => {
      index = (index + 1) % phrases.length;
      setLoadingText(phrases[index]);
    }, 2000);

    return () => clearInterval(interval);
  }, [currentScreen]);

  // Persistent user profiles helper
  const handleSaveSession = (newContext: MoodContext) => {
    try {
      const updatedProfile: UserProfile = {
        swipeHistory: profile.swipeHistory,
        lastContext: newContext,
        sessionCount: (profile.sessionCount || 0) + 1,
      };
      setProfile(updatedProfile);
      localStorage.setItem("mise_profile", JSON.stringify(updatedProfile));
    } catch (e) {
      console.error("Failed to persist model payload:", e);
    }
  };

  // Skip questions and search restaurants directly using returning profile context
  const handleSkipSetter = () => {
    if (profile.lastContext) {
      setContext(profile.lastContext);
      setShowPrefillBanner(false);
      triggerRestaurantFetch(profile.lastContext);
    }
  };

  // Proceed to next question or execute recommendations discovery
  const handleSelectOption = (key: keyof MoodContext, value: string) => {
    const nextContext = { ...context, [key]: value };
    setContext(nextContext);

    // Subtle 280ms timeout for interactive feedback
    setTimeout(() => {
      if (questionIndex === 0) {
        setQuestionIndex(1);
      } else if (questionIndex === 1) {
        setQuestionIndex(2);
      } else {
        triggerRestaurantFetch(nextContext);
      }
    }, 280);
  };

  // Query server-side controller for scored candidates
  const triggerRestaurantFetch = (searchContext: MoodContext) => {
    setCurrentScreen("loading");
    handleSaveSession(searchContext);

    // Compute liked cuisines & recently rejected places from local profile model
    const likes = profile.swipeHistory
      .filter((h) => h.direction === "right")
      .map((h) => h.cuisineType);
    const dislikes = profile.swipeHistory
      .filter((h) => h.direction === "left" && Date.now() - h.timestamp < 7 * 24 * 60 * 60 * 1000)
      .map((h) => h.placeId);

    fetch("/api/recommendations", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        mood: searchContext.mood,
        occasion: searchContext.occasion,
        budget: searchContext.budget,
        lat: coordinates?.lat,
        lng: coordinates?.lng,
        cuisineLikes: likes,
        recentDislikes: dislikes,
      }),
    })
      .then((res) => {
        if (!res.ok) throw new Error("Server search coordinates rejected.");
        return res.json();
      })
      .then((data) => {
        if (data.restaurants && data.restaurants.length > 0) {
          setRestaurants(data.restaurants);
          setCardIndex(0);
          setCurrentScreen("swipe");
        } else {
          setCurrentScreen("empty");
        }
      })
      .catch((e) => {
        console.error("Restaurant fetch failed:", e);
        setCurrentScreen("empty");
      });
  };

  // Execute deep-link navigation
  const openMapsUrl = (rest: Restaurant) => {
    const url = `https://www.google.com/maps/search/?api=1&query=${rest.location.lat},${rest.location.lng}&query_place_id=${rest.id}`;
    window.open(url, "_blank");
  };

  // Learning model swipe logging
  const recordSwipeResult = (rest: Restaurant, direction: "left" | "right") => {
    try {
      const item: SwipeItem = {
        placeId: rest.id,
        name: rest.name,
        direction,
        context: { ...context },
        timestamp: Date.now(),
        cuisineType: rest.types[0] || "",
        priceLevel: rest.priceLevel,
      };

      const updatedHistory = [item, ...profile.swipeHistory];
      const updatedProfile = {
        ...profile,
        swipeHistory: updatedHistory,
      };

      setProfile(updatedProfile);
      localStorage.setItem("mise_profile", JSON.stringify(updatedProfile));
    } catch (e) {
      console.warn("Could not save swipe interaction to profile:", e);
    }
  };

  // Left Swipe Rejected Card
  const handleRejectCard = (index: number) => {
    if (index >= restaurants.length) return;
    const rest = restaurants[index];
    recordSwipeResult(rest, "left");

    // Animate Next
    setExitDirection("left");
    setTimeout(() => {
      setExitDirection(null);
      setDragOffset({ x: 0, y: 0 });
      if (index + 1 < restaurants.length) {
        setCardIndex(index + 1);
      } else {
        setCurrentScreen("empty");
      }
    }, 250);
  };

  // Right Swipe Accepted Card
  const handleAcceptCard = (index: number) => {
    if (index >= restaurants.length) return;
    const rest = restaurants[index];
    recordSwipeResult(rest, "right");

    // Warm Amber Accept Flash
    setExitDirection("right");
    setShowAmberFlash(true);

    setTimeout(() => {
      setShowAmberFlash(false);
      setExitDirection(null);
      setDragOffset({ x: 0, y: 0 });
      openMapsUrl(rest);
    }, 350);
  };

  // Pointer Event Swipe interactions
  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    setDragStart({ x: e.clientX, y: e.clientY });
    setIsSwiping(true);
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!isSwiping || !dragStart) return;
    const dx = e.clientX - dragStart.x;
    const dy = e.clientY - dragStart.y;
    setDragOffset({ x: dx, y: dy });
  };

  const handlePointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!isSwiping) return;
    setIsSwiping(false);
    e.currentTarget.releasePointerCapture(e.pointerId);

    const threshold = 100;
    const totalDrag = dragOffset.x;

    // Check click/tap distinction
    if (Math.abs(dragOffset.x) < 8 && Math.abs(dragOffset.y) < 8) {
      // Tap detected -> slide up deep details sheet
      setSelectedRestaurant(restaurants[cardIndex]);
      setIsDrawerOpen(true);
    } else {
      // Swipe threshold checks
      if (totalDrag > threshold) {
        handleAcceptCard(cardIndex);
      } else if (totalDrag < -threshold) {
        handleRejectCard(cardIndex);
      } else {
        // Snap back to center with spring simulation
        setDragOffset({ x: 0, y: 0 });
      }
    }
    setDragStart(null);
  };

  // Direct Button actions in Card body
  const triggerSwipeLeftExplicit = () => {
    handleRejectCard(cardIndex);
  };

  const triggerSwipeRightExplicit = () => {
    handleAcceptCard(cardIndex);
  };

  // Service Badge configurations
  const renderBadgeDotColor = (attitude: string) => {
    if (attitude === "ATTENTIVE") return "bg-[#6FCF97]";
    if (attitude === "STANDARD") return "bg-[#F2C94C]";
    return "bg-[#5C5850]";
  };

  const renderBadgeLabel = (attitude: string) => {
    if (attitude === "ATTENTIVE") return "● ATTENTIVE";
    if (attitude === "STANDARD") return "● STANDARD";
    return "● UNKNOWN";
  };

  // Generate Currency pricing string
  const renderPriceIndicator = (level: number) => {
    return "$".repeat(Math.max(1, Math.min(4, level)));
  };

  // Render standby configuration module if key errors appear
  const hasValidKeys = true; // Always allow transparent out-of-the-box demo mode with mock data fallbacks

  return (
    <div className="min-h-screen md:min-h-[100dvh] w-full bg-[#030303] flex items-center justify-center p-0 md:py-4">
      <div
        id="app-container"
        className="max-w-[390px] w-full h-screen md:h-[844px] md:max-h-[844px] bg-[#0D0D0D] border border-transparent md:border-[#2A2A2A] rounded-none md:rounded-[32px] relative flex flex-col justify-between overflow-hidden shadow-2xl transition-all duration-300 select-none"
      >
        {/* Full-Screen Amber Flash Visual effect on accept */}
        {showAmberFlash && (
          <div className="absolute inset-0 bg-[#C8714A]/15 z-50 pointer-events-none transition-opacity duration-150 animate-pulse" />
        )}

        {/* ⚙️ AIS Missing Keys fallback dashboard - renders inline to prevent crash */}
        {!hasValidKeys && (
          <div className="absolute inset-0 bg-[#0E0E0E] flex flex-col justify-between p-6 z-50 overflow-y-auto no-scrollbar">
            <div className="flex flex-col items-center text-center mt-6">
              <div className="h-12 w-12 rounded-full bg-[#C8714A]/10 border border-[#C8714A]/30 flex items-center justify-center text-[#C8714A] mb-4">
                <AlertTriangle className="h-6 w-6" />
              </div>
              <h1 className="font-serif text-3xl font-medium tracking-tight text-[#F5F0E8] mb-2">
                Your Choice Setup Dashboard
              </h1>
              <p className="text-[#9A9488] text-sm leading-relaxed mb-6">
                To start tasting the neighborhood, specify your private credentials in Google AI Studio.
              </p>

              <div className="w-full space-y-4 text-left">
                {/* Check Gemini key */}
                <div className="bg-[#141414] border border-[#2A2A2A] rounded-xl p-4">
                  <div className="flex justify-between items-center mb-1">
                    <span className="font-sans text-xs font-semibold uppercase tracking-wider text-[#9A9488]">
                      Gemini AI API Key
                    </span>
                    {apiStatus.hasGemini ? (
                      <span className="text-xs text-[#6FCF97] font-medium flex items-center gap-1">
                        ● CONFIGURED
                      </span>
                    ) : (
                      <span className="text-xs text-[#C8714A]/80 font-medium flex items-center gap-1">
                        ● MISSING
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-[#5C5850]">
                    Powers personalized recommendation line generations & review attitude badges.
                  </p>
                </div>

                {/* Check Maps key */}
                <div className="bg-[#141414] border border-[#2A2A2A] rounded-xl p-4">
                  <div className="flex justify-between items-center mb-1">
                    <span className="font-sans text-xs font-semibold uppercase tracking-wider text-[#9A9488]">
                      Google Maps Platform Key
                    </span>
                    {apiStatus.hasGoogleMaps ? (
                      <span className="text-xs text-[#6FCF97] font-medium flex items-center gap-1">
                        ● CONFIGURED
                      </span>
                    ) : (
                      <span className="text-xs text-[#C8714A]/80 font-medium flex items-center gap-1">
                        ● MISSING
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-[#5C5850]">
                    Required for Nearby Restaurant Search (New), Static map thumbnails & listings.
                  </p>
                </div>
              </div>

              {/* Instructions block */}
              <div className="w-full bg-[#1A1A1A] border border-[#2A2A2A] rounded-2xl p-4 mt-6 text-xs text-left text-[#9A9488] space-y-3">
                <p className="font-semibold text-[#F5F0E8] text-center pb-1">
                  How to configure credentials inside AI Studio:
                </p>
                <div className="flex gap-2">
                  <span className="h-5 w-5 rounded-full bg-[#2A2A2A] text-center text-[#F5F0E8] font-medium flex items-center justify-center shrink-0">
                    1
                  </span>
                  <p className="leading-snug">
                    Get a Google Maps key:{" "}
                    <a
                      href="https://console.cloud.google.com/google/maps-apis/start?utm_campaign=gmp-code-assist-ais"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-[#C8714A] hover:underline flex items-center gap-0.5 inline-flex"
                    >
                      Console Link <ExternalLink className="h-3 w-3 inline" />
                    </a>
                  </p>
                </div>
                <div className="flex gap-2">
                  <span className="h-5 w-5 rounded-full bg-[#2A2A2A] text-center text-[#F5F0E8] font-medium flex items-center justify-center shrink-0">
                    2
                  </span>
                  <p className="leading-snug">
                    Open the <strong className="text-[#F5F0E8]">Secrets panel</strong> inside ⚙️{" "}
                    <strong className="text-[#F5F0E8]">Settings</strong> (the gear icon on top-right corner).
                  </p>
                </div>
                <div className="flex gap-2">
                  <span className="h-5 w-5 rounded-full bg-[#2A2A2A] text-center text-[#F5F0E8] font-medium flex items-center justify-center shrink-0">
                    3
                  </span>
                  <p className="leading-snug">
                    Add <code className="text-[#C8714A] font-mono">GOOGLE_MAPS_PLATFORM_KEY</code> and{" "}
                    <code className="text-[#C8714A] font-mono">GEMINI_API_KEY</code> respectively.
                  </p>
                </div>
                <div className="flex gap-2">
                  <span className="h-5 w-5 rounded-full bg-[#2A2A2A] text-center text-[#F5F0E8] font-medium flex items-center justify-center shrink-0">
                    4
                  </span>
                  <p className="leading-snug text-[#5C5850]">
                    The workspace compiles and boots automatically. No page reloads needed.
                  </p>
                </div>
              </div>
            </div>

            <button
              onClick={() => {
                fetch("/api/status")
                  .then((r) => r.json())
                  .then(setApiStatus)
                  .catch(() => {});
              }}
              className="w-full bg-[#C8714A] hover:bg-[#C8714A]/90 active:scale-[0.98] text-white py-3.5 rounded-xl font-sans text-sm font-medium transition-all"
            >
              Verify Config & Try Again
            </button>
          </div>
        )}

        {/* ========================================================
            SCREEN 1: START SCREEN
           ======================================================== */}
        {currentScreen === "splash" && (
          <div className="flex-1 w-full flex flex-col justify-between py-12 px-4 bg-[#0D0D0D] text-center">
            {/* Middle Branding Block (Perfect Centering) */}
            <div className="flex-1 flex flex-col justify-center items-center">
              {/* App Brand Title */}
              <h1 className="font-serif text-[48px] font-medium text-[#F5F0E8] tracking-tight select-none pb-2 leading-none animate-[fadeIn_800ms_ease-out]">
                Your Choice
              </h1>
              {/* Animated centering rule */}
              <div className="w-16 h-[1px] bg-[#C8714A] mx-auto animate-[widthSpread_1.2s_cubic-bezier(0.16,1,0.3,1)] mb-6" />
              {/* App Quirky Tagline */}
              <p className="font-serif text-sm italic text-[#9A9488] font-light tracking-wide whitespace-nowrap select-none animate-[fadeIn_1.4s_ease-out]">
                Because “I don't know” is not a dinner plan.
              </p>
            </div>

            {/* Bottom Interactive CTA */}
            <div className="w-full flex justify-center mt-auto">
              <button
                onClick={() => setCurrentScreen("mood")}
                className="w-full max-w-[280px] bg-transparent hover:bg-[#C8714A]/[0.06] border border-[#C8714A] text-[#C8714A] active:scale-[0.97] py-4 rounded-xl font-sans text-xs font-semibold tracking-wider uppercase transition-all duration-150 animate-[fadeIn_1.8s_ease-out]"
              >
                Click to Continue
              </button>
            </div>
          </div>
        )}

        {/* ========================================================
            SCREEN 2: MOOD SETTER (CONTEXT INPUT)
           ======================================================== */}
        {currentScreen === "mood" && (
          <div className="flex-1 w-full flex flex-col justify-between py-8 px-5 bg-[#0D0D0D] transition-opacity duration-300">
            {/* Top Center Progress indicator */}
            <div className="flex justify-center items-center gap-2 h-4 mb-4">
              <span
                className={`h-1.5 rounded-full transition-all duration-200 ${
                  questionIndex === 0 ? "w-4 bg-[#C8714A]" : "w-1.5 bg-[#2A2A2A]"
                }`}
              />
              <span
                className={`h-1.5 rounded-full transition-all duration-200 ${
                  questionIndex === 1 ? "w-4 bg-[#C8714A]" : "w-1.5 bg-[#2A2A2A]"
                }`}
              />
              <span
                className={`h-1.5 rounded-full transition-all duration-200 ${
                  questionIndex === 2 ? "w-4 bg-[#C8714A]" : "w-1.5 bg-[#2A2A2A]"
                }`}
              />
            </div>

            {/* Quick Profile Bypass Shortcuts banner for returning users */}
            {questionIndex === 0 && showPrefillBanner && profile.lastContext && (
              <div className="bg-[#141414] border border-[#2A2A2A] rounded-xl p-3 mb-6 animate-fade-in flex items-center justify-between">
                <div onClick={handleSkipSetter} className="flex-1 cursor-pointer">
                  <p className="text-[11px] font-sans text-[#5C5850] uppercase tracking-wider mb-0.5">
                    Fast Pass Shortcut
                  </p>
                  <p className="text-xs text-[#9A9488] font-sans truncate">
                    Same as last time:{" "}
                    <span className="text-[#F5F0E8]">
                      {PRETTY_LABELS[profile.lastContext.mood]} · {PRETTY_LABELS[profile.lastContext.occasion]}
                    </span>
                  </p>
                </div>
                <button
                  onClick={() => setShowPrefillBanner(false)}
                  className="text-xs text-[#C8714A] hover:underline font-sans ml-2 flex items-center shrink-0"
                >
                  Change <ChevronRight className="h-3 w-3 inline" />
                </button>
              </div>
            )}

            {/* Questions Container with Slide layouts */}
            <div className="flex-1 flex flex-col justify-center my-auto">
              {/* Question 1 Slider */}
              {questionIndex === 0 && (
                <div className="space-y-6 animate-[slideInRight_300ms_cubic-bezier(0.16,1,0.3,1)]">
                  <h2 className="font-serif text-[28px] italic text-[#F5F0E8] text-center mb-8">
                    What are you feeling?
                  </h2>
                  <div className="space-y-3">
                    <button
                      onClick={() => handleSelectOption("mood", "comfort")}
                      className={`w-full text-left font-sans text-sm md:text-base border ${
                        context.mood === "comfort" ? "border-[#C8714A] bg-[#C8714A]/[0.06]" : "border-[#2A2A2A] bg-transparent"
                      } text-[#F5F0E8] py-4 px-6 rounded-xl transition-all duration-200 active:scale-[0.98] outline-none hover:border-[#C8714A]/40 flex justify-between items-center`}
                    >
                      <span className="flex items-center gap-3">
                        <span className="text-[#C8714A]">{SYMBOLS_MAP.comfort}</span>
                        Comfort food
                      </span>
                      <ChevronRight className="h-4 w-4 text-[#5C5850]" />
                    </button>

                    <button
                      onClick={() => handleSelectOption("mood", "new")}
                      className={`w-full text-left font-sans text-sm md:text-base border ${
                        context.mood === "new" ? "border-[#C8714A] bg-[#C8714A]/[0.06]" : "border-[#2A2A2A] bg-transparent"
                      } text-[#F5F0E8] py-4 px-6 rounded-xl transition-all duration-200 active:scale-[0.98] outline-none hover:border-[#C8714A]/40 flex justify-between items-center`}
                    >
                      <span className="flex items-center gap-3">
                        <span className="text-[#C8714A]">{SYMBOLS_MAP.new}</span>
                        Something new
                      </span>
                      <ChevronRight className="h-4 w-4 text-[#5C5850]" />
                    </button>

                    <button
                      onClick={() => handleSelectOption("mood", "light")}
                      className={`w-full text-left font-sans text-sm md:text-base border ${
                        context.mood === "light" ? "border-[#C8714A] bg-[#C8714A]/[0.06]" : "border-[#2A2A2A] bg-transparent"
                      } text-[#F5F0E8] py-4 px-6 rounded-xl transition-all duration-200 active:scale-[0.98] outline-none hover:border-[#C8714A]/40 flex justify-between items-center`}
                    >
                      <span className="flex items-center gap-3">
                        <span className="text-[#C8714A]">{SYMBOLS_MAP.light}</span>
                        Light & fresh
                      </span>
                      <ChevronRight className="h-4 w-4 text-[#5C5850]" />
                    </button>

                    <button
                      onClick={() => handleSelectOption("mood", "indulgent")}
                      className={`w-full text-left font-sans text-sm md:text-base border ${
                        context.mood === "indulgent" ? "border-[#C8714A] bg-[#C8714A]/[0.06]" : "border-[#2A2A2A] bg-transparent"
                      } text-[#F5F0E8] py-4 px-6 rounded-xl transition-all duration-200 active:scale-[0.98] outline-none hover:border-[#C8714A]/40 flex justify-between items-center`}
                    >
                      <span className="flex items-center gap-3">
                        <span className="text-[#C8714A]">{SYMBOLS_MAP.indulgent}</span>
                        Indulgent treat
                      </span>
                      <ChevronRight className="h-4 w-4 text-[#5C5850]" />
                    </button>
                  </div>
                </div>
              )}

              {/* Question 2 Slider */}
              {questionIndex === 1 && (
                <div className="space-y-6 animate-[slideInRight_300ms_cubic-bezier(0.16,1,0.3,1)]">
                  <div className="flex items-center justify-between px-2 mb-4">
                    <button
                      onClick={() => setQuestionIndex(0)}
                      className="text-xs font-sans text-[#5C5850] hover:text-[#9A9488]"
                    >
                      ← Back
                    </button>
                  </div>
                  <h2 className="font-serif text-[28px] italic text-[#F5F0E8] text-center mb-8">
                    What's the occasion?
                  </h2>
                  <div className="space-y-3">
                    <button
                      onClick={() => handleSelectOption("occasion", "solo")}
                      className={`w-full text-left font-sans text-sm md:text-base border ${
                        context.occasion === "solo" ? "border-[#C8714A] bg-[#C8714A]/[0.06]" : "border-[#2A2A2A] bg-transparent"
                      } text-[#F5F0E8] py-4 px-6 rounded-xl transition-all duration-200 active:scale-[0.98] outline-none flex justify-between items-center`}
                    >
                      <span className="flex items-center gap-3">
                        <span className="text-[#C8714A]">{SYMBOLS_MAP.solo}</span>
                        Just me
                      </span>
                      <ChevronRight className="h-4 w-4 text-[#5C5850]" />
                    </button>

                    <button
                      onClick={() => handleSelectOption("occasion", "someone")}
                      className={`w-full text-left font-sans text-sm md:text-base border ${
                        context.occasion === "someone" ? "border-[#C8714A] bg-[#C8714A]/[0.06]" : "border-[#2A2A2A] bg-transparent"
                      } text-[#F5F0E8] py-4 px-6 rounded-xl transition-all duration-200 active:scale-[0.98] outline-none flex justify-between items-center`}
                    >
                      <span className="flex items-center gap-3">
                        <span className="text-[#C8714A]">{SYMBOLS_MAP.someone}</span>
                        With someone
                      </span>
                      <ChevronRight className="h-4 w-4 text-[#5C5850]" />
                    </button>

                    <button
                      onClick={() => handleSelectOption("occasion", "group")}
                      className={`w-full text-left font-sans text-sm md:text-base border ${
                        context.occasion === "group" ? "border-[#C8714A] bg-[#C8714A]/[0.06]" : "border-[#2A2A2A] bg-transparent"
                      } text-[#F5F0E8] py-4 px-6 rounded-xl transition-all duration-200 active:scale-[0.98] outline-none flex justify-between items-center`}
                    >
                      <span className="flex items-center gap-3">
                        <span className="text-[#C8714A]">{SYMBOLS_MAP.group}</span>
                        Group outing
                      </span>
                      <ChevronRight className="h-4 w-4 text-[#5C5850]" />
                    </button>
                  </div>
                </div>
              )}

              {/* Question 3 Slider */}
              {questionIndex === 2 && (
                <div className="space-y-6 animate-[slideInRight_300ms_cubic-bezier(0.16,1,0.3,1)]">
                  <div className="flex items-center justify-between px-2 mb-4">
                    <button
                      onClick={() => setQuestionIndex(1)}
                      className="text-xs font-sans text-[#5C5850] hover:text-[#9A9488]"
                    >
                      ← Back
                    </button>
                  </div>
                  <h2 className="font-serif text-[28px] italic text-[#F5F0E8] text-center mb-8">
                    What's your spend?
                  </h2>
                  <div className="space-y-3">
                    <button
                      onClick={() => handleSelectOption("budget", "cheap")}
                      className={`w-full text-left font-sans text-sm md:text-base border ${
                        context.budget === "cheap" ? "border-[#C8714A] bg-[#C8714A]/[0.06]" : "border-[#2A2A2A] bg-transparent"
                      } text-[#F5F0E8] py-4 px-6 rounded-xl transition-all duration-200 active:scale-[0.98] outline-none flex justify-between items-center`}
                    >
                      <span className="flex flex-col text-left">
                        <span className="font-medium text-[#F5F0E8] flex items-center gap-2">
                          <span className="text-[#C8714A]">{SYMBOLS_MAP.cheap}</span> Keep it cheap
                        </span>
                        <span className="text-xs text-[#5C5850] ml-7">Under $20 per person</span>
                      </span>
                      <ChevronRight className="h-4 w-4 text-[#5C5850]" />
                    </button>

                    <button
                      onClick={() => handleSelectOption("budget", "midrange")}
                      className={`w-full text-left font-sans text-sm md:text-base border ${
                        context.budget === "midrange" ? "border-[#C8714A] bg-[#C8714A]/[0.06]" : "border-[#2A2A2A] bg-transparent"
                      } text-[#F5F0E8] py-4 px-6 rounded-xl transition-all duration-200 active:scale-[0.98] outline-none flex justify-between items-center`}
                    >
                      <span className="flex flex-col text-left">
                        <span className="font-medium text-[#F5F0E8] flex items-center gap-2">
                          <span className="text-[#C8714A]">{SYMBOLS_MAP.midrange}</span> Mid-range
                        </span>
                        <span className="text-xs text-[#5C5850] ml-7">~$20–$50 per person</span>
                      </span>
                      <ChevronRight className="h-4 w-4 text-[#5C5850]" />
                    </button>

                    <button
                      onClick={() => handleSelectOption("budget", "treat")}
                      className={`w-full text-left font-sans text-sm md:text-base border ${
                        context.budget === "treat" ? "border-[#C8714A] bg-[#C8714A]/[0.06]" : "border-[#2A2A2A] bg-transparent"
                      } text-[#F5F0E8] py-4 px-6 rounded-xl transition-all duration-200 active:scale-[0.98] outline-none flex justify-between items-center`}
                    >
                      <span className="flex flex-col text-left">
                        <span className="font-medium text-[#F5F0E8] flex items-center gap-2">
                          <span className="text-[#C8714A]">{SYMBOLS_MAP.treat}</span> Treat myself
                        </span>
                        <span className="text-xs text-[#5C5850] ml-7">~$50–$100+ per person</span>
                      </span>
                      <ChevronRight className="h-4 w-4 text-[#5C5850]" />
                    </button>
                  </div>
                </div>
              )}
            </div>

            {/* Geolocation status warnings */}
            {geoNotice && (
              <p className="text-[11px] text-[#9A9488]/70 text-center font-sans mt-4 px-4 leading-normal">
                {geoNotice}
              </p>
            )}
          </div>
        )}

        {/* ========================================================
            SCREEN 3: LOADING STATE
           ======================================================== */}
        {currentScreen === "loading" && (
          <div className="flex-1 w-full flex flex-col items-center justify-center bg-[#0D0D0D] px-6">
            <div className="relative w-44 h-[1px] bg-[#2A2A2A] mb-6 overflow-hidden">
              <div className="loading-sweep" />
            </div>
            <p className="font-sans text-xs text-[#9A9488] leading-tight text-center tracking-wide animate-pulse">
              {loadingText}
            </p>
          </div>
        )}

        {/* ========================================================
            SCREEN 4: SWIPE CARDS (RANKED RECOMMENDATIONS)
           ======================================================== */}
        {currentScreen === "swipe" && (
          <div className="flex-1 w-full flex flex-col justify-between py-6 px-4 bg-[#0D0D0D] relative">
            
            {/* Header section with Reset query button */}
            <div className="flex justify-between items-center px-1 mb-3 shrink-0">
              <div className="flex items-center gap-1.5">
                <Sparkles className="h-3.5 w-3.5 text-[#C8714A]" />
                <span className="text-[11px] font-sans font-medium tracking-[0.1em] uppercase text-[#9A9488]">
                  {PRETTY_LABELS[context.mood]} Picks
                </span>
              </div>
              <button
                onClick={() => {
                  setQuestionIndex(0);
                  setContext({ mood: "", occasion: "", budget: "" });
                  setCurrentScreen("mood");
                }}
                className="text-[11px] font-sans font-medium hover:text-[#F5F0E8] transition-colors tracking-wider uppercase text-[#5C5850] flex items-center gap-1"
              >
                <RefreshCw className="h-3 w-3" /> Reset
              </button>
            </div>

            {/* The Stack frame */}
            <div className="flex-1 flex justify-center items-center relative w-full h-full max-h-[580px] my-auto">
              {restaurants.map((rest, index) => {
                // Render visible top stack cards limit
                if (index < cardIndex || index > cardIndex + 2) return null;

                const isCurrent = index === cardIndex;
                const offsetIndex = index - cardIndex;

                // Standard stack values
                const scale = 1 - offsetIndex * 0.04;
                const translateY = -offsetIndex * 8;
                const zIndex = 30 - offsetIndex;
                const isStackBehind = offsetIndex > 0;

                // Setup swipe dragging styles
                const transformStyle = isCurrent
                  ? `translate(${dragOffset.x}px, ${dragOffset.y}px) rotate(${dragOffset.x * 0.03}deg)`
                  : `translateY(${translateY}px) scale(${scale})`;

                // Edge glowing shadow settings based on pointer delta direction
                let customShadowStyle = "0 16px 36px rgba(0,0,0,0.5)";
                if (isCurrent && dragOffset.x > 15) {
                  const opacity = Math.min(0.35, dragOffset.x / 150);
                  customShadowStyle = `0 16px 36px rgba(0,0,0,0.5), inset -8px 0 32px rgba(200, 113, 74, ${opacity})`;
                } else if (isCurrent && dragOffset.x < -15) {
                  const opacity = Math.min(0.25, Math.abs(dragOffset.x) / 150);
                  customShadowStyle = `0 16px 36px rgba(0,0,0,0.5), inset 8px 0 32px rgba(107, 143, 122, ${opacity})`;
                }

                // Retrieve photo reference
                const hasPhoto = rest.photos && rest.photos.length > 0;
                const photoSrc = hasPhoto
                  ? `/api/photo?name=${encodeURIComponent(rest.photos[0].name || "")}`
                  : null;

                return (
                  <div
                    key={rest.id}
                    onPointerDown={isCurrent ? handlePointerDown : undefined}
                    onPointerMove={isCurrent ? handlePointerMove : undefined}
                    onPointerUp={isCurrent ? handlePointerUp : undefined}
                    className={`absolute w-full h-[72vh] max-h-[480px] bg-[#141414] border border-[#2A2A2A] rounded-2xl overflow-hidden select-none select-none transition-all duration-300 ${isCurrent ? "" : "pointer-events-none"}`}
                    style={{
                      transform: transformStyle,
                      zIndex,
                      boxShadow: customShadowStyle,
                      willChange: "transform",
                      cursor: isCurrent ? "grab" : "default",
                      transition: isCurrent && isSwiping ? "none" : "transform 400ms cubic-bezier(0.16, 1, 0.3, 1), box-shadow 250ms ease",
                    }}
                  >
                    {/* Floating service badge on Photo overlay (top right) */}
                    <div className="absolute top-4 right-4 z-40 bg-[#0D0D0D]/75 backdrop-blur-md border border-white/5 py-1 px-2.5 rounded-full shadow-lg flex items-center gap-1.5">
                      <span className={`h-1.5 w-1.5 rounded-full ${renderBadgeDotColor(rest.serviceAttitude || "UNKNOWN")}`} />
                      <span className="text-[10px] font-mono tracking-wider font-medium text-[#F5F0E8] uppercase">
                        {renderBadgeLabel(rest.serviceAttitude || "UNKNOWN")}
                      </span>
                    </div>

                    {/* Left/Right swipe direction overlays on the top Card */}
                    {isCurrent && Math.abs(dragOffset.x) > 20 && (
                      <div className="absolute inset-x-0 top-12 z-40 flex justify-between px-6 pointer-events-none">
                        <span
                          className="font-sans text-xs font-semibold uppercase tracking-[0.15em] border border-[#C8714A] bg-[#0E0E0E]/90 text-[#C8714A] py-1 px-3 rounded-lg shadow-md transition-opacity duration-150"
                          style={{ opacity: Math.min(1, dragOffset.x / 60) }}
                        >
                          GO →
                        </span>
                        <span
                          className="font-sans text-xs font-semibold uppercase tracking-[0.15em] border border-[#9A9488]/30 bg-[#0E0E0E]/90 text-[#9A9488] py-1 px-3 rounded-lg shadow-md transition-opacity duration-150"
                          style={{ opacity: Math.min(1, -dragOffset.x / 60) }}
                        >
                          ← PASS
                        </span>
                      </div>
                    )}

                    {/* Photo Container */}
                    <div className="relative w-full h-[55%] bg-[#1A1A1A] overflow-hidden">
                      {photoSrc ? (
                        <img
                          src={photoSrc}
                          alt={rest.name}
                          className="w-full h-full object-cover select-none pointer-events-none"
                          onError={(e) => {
                            // Render fallback symbol
                            (e.target as HTMLElement).style.display = "none";
                          }}
                        />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center bg-[#1A1A1A]">
                          <span className="font-serif text-5xl font-medium text-[#5C5850]">
                            {rest.name.charAt(0)}
                          </span>
                        </div>
                      )}
                      
                      {/* Ground Shadow mask at bottom of photo block */}
                      <div className="absolute inset-x-0 bottom-0 h-28 bg-gradient-to-t from-[#141414] via-[#141414]/40 to-transparent pointer-events-none" />
                    </div>

                    {/* Metadata Section wrapper */}
                    <div className="px-5 pt-3 pb-8 flex flex-col justify-between flex-1">
                      <div>
                        {/* Title header */}
                        <h3 className="font-serif text-2xl font-medium text-[#F5F0E8] tracking-normal mb-1.5 truncate leading-tight select-none">
                          {rest.name}
                        </h3>

                        {/* Attribute pills / details indicators */}
                        <div className="flex items-center gap-1.5 flex-wrap text-xs text-[#9A9488] select-none font-sans">
                          <span>{rest.cuisine}</span>
                          <span className="text-[#3A3832]">·</span>
                          <span>{rest.distance < 1 ? "0.4 km" : `${rest.distance.toFixed(1)} km`}</span>
                          <span className="text-[#3A3832]">·</span>
                          <span className="text-[#F5F0E8]/70 font-medium">
                            {renderPriceIndicator(rest.priceLevel)}
                          </span>
                        </div>
                      </div>

                      {/* Editorial Personalized Line */}
                      <div className="mt-4 border-t border-[#2A2A2A]/40 pt-3">
                        <p className="font-sans text-xs italic text-[#C8714A] leading-relaxed line-clamp-2 select-none">
                          {rest.whyThis || "Highly rated · Open now · Matches your mood."}
                        </p>
                      </div>

                      {/* Action helpers block indicators */}
                      {isCurrent && cardIndex === 0 && (
                        <div className="absolute inset-x-0 bottom-3 flex justify-between px-5 pointer-events-none animate-fade-in opacity-40">
                          <span className="text-[9px] font-sans font-medium uppercase tracking-[0.08em] text-[#5C5850]">
                            ← PASS
                          </span>
                          <span className="text-[9px] font-sans font-medium uppercase tracking-[0.08em] text-[#5C5850]">
                            GO →
                          </span>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Micro Interaction Explicit control buttons bar */}
            <div className="flex justify-between items-center gap-4 px-2 mt-4 shrink-0">
              <button
                onClick={triggerSwipeLeftExplicit}
                className="flex-1 bg-[#141414]/60 hover:bg-[#1A1A1A] border border-[#2A2A2A] text-[#9A9488] active:scale-[0.97] py-3.5 rounded-xl font-sans text-xs font-semibold uppercase tracking-wider transition-all duration-150"
              >
                Pass
              </button>
              <button
                onClick={triggerSwipeRightExplicit}
                className="flex-1 bg-[#C8714A] hover:bg-[#D57B53] text-[#FFFFFF] active:scale-[0.97] py-3.5 rounded-xl font-sans text-xs font-semibold uppercase tracking-wider transition-all duration-150 shadow-lg shadow-[#C8714A]/10"
              >
                Let's Go
              </button>
            </div>
          </div>
        )}

        {/* ========================================================
            SCREEN 5: EMPTY STATE (ALL VISITED)
           ======================================================== */}
        {currentScreen === "empty" && (
          <div className="flex-1 w-full flex flex-col justify-center items-center p-6 text-center select-none bg-[#0D0D0D]">
            <div className="h-10 w-10 text-[#C8714A] mb-4 flex items-center justify-center bg-[#C8714A]/10 border border-[#C8714A]/25 rounded-full">
              <Compass className="h-5 w-5" />
            </div>
            <h2 className="font-serif text-2xl italic text-[#F5F0E8] mb-2 leading-tight">
              Nothing landed tonight.
            </h2>
            <p className="font-sans text-xs text-[#9A9488] leading-relaxed max-w-xs mb-8">
              Adjust your context choices to explore other matches in the neighborhood.
            </p>
            <button
              onClick={() => {
                setQuestionIndex(0);
                setContext({ mood: "", occasion: "", budget: "" });
                setCurrentScreen("mood");
              }}
              className="px-8 py-3 bg-transparent border border-[#C8714A] text-[#C8714A] hover:bg-[#C8714A]/[0.04] transition-all rounded-xl font-sans text-xs font-semibold tracking-wider uppercase active:scale-[0.98]"
            >
              Try Again
            </button>
          </div>
        )}

        {/* ========================================================
            DETAIL DRAWER (TAP TO EXPAND INTERACTIVE SHEET)
           ======================================================== */}
        {isDrawerOpen && selectedRestaurant && (
          <>
            {/* Scrim background mask */}
            <div
              className="absolute inset-0 bg-[#030303]/70 z-40 transition-opacity duration-300 pointer-events-auto"
              onClick={() => setIsDrawerOpen(false)}
            />

            {/* Sliding Panel sheet */}
            <div className="absolute inset-x-0 bottom-0 max-h-[65vh] bg-[#1A1A1A] border-t border-[#2A2A2A] rounded-t-[24px] p-6 z-50 overflow-y-auto no-scrollbar flex flex-col select-none pointer-events-auto animate-[slideUp_300ms_cubic-bezier(0.16,1,0.3,1)]">
              {/* Center Drag Handle pill */}
              <div
                onClick={() => setIsDrawerOpen(false)}
                className="w-9 h-1 bg-[#2A2A2A] rounded-full mx-auto mb-5 shrink-0 cursor-pointer hover:bg-[#3A3A3A] transition-colors"
              />

              {/* Header Title Information */}
              <div className="mb-4">
                <h3 className="font-serif text-[22px] font-medium text-[#F5F0E8] tracking-normal mb-1">
                  {selectedRestaurant.name}
                </h3>
                <div className="flex items-center gap-1.5 text-xs text-[#9A9488] select-none font-sans mb-2">
                  <span>{selectedRestaurant.cuisine}</span>
                  <span>·</span>
                  <span className="text-xs text-[#5C5850]">{selectedRestaurant.address}</span>
                </div>

                {/* Opening Hours status display line */}
                <div className="flex items-center gap-1.5 text-xs font-sans mt-2">
                  <span
                    className={`h-1.5 w-1.5 rounded-full ${
                      selectedRestaurant.isOpen ? "bg-[#6FCF97]" : "bg-[#EB5757]"
                    }`}
                  />
                  <span className={selectedRestaurant.isOpen ? "text-[#6FCF97]" : "text-[#EB5757]"}>
                    {selectedRestaurant.isOpen ? "Open now" : "Closed now"}
                  </span>
                </div>
              </div>

              <div className="h-[1px] bg-[#2A2A2A] w-full my-4 shrink-0" />

              {/* Best Standout review quote fragment callout */}
              {selectedRestaurant.reviews && selectedRestaurant.reviews.length > 0 && (
                <div className="mb-5 text-left relative pl-2">
                  <span className="font-serif text-[32px] text-[#C8714A] leading-none absolute -left-2 -top-1 opacity-70">
                    "
                  </span>
                  <p className="font-serif text-sm italic text-[#9A9488] leading-relaxed pl-4 pt-1">
                    {selectedRestaurant.reviews[0].text?.text || selectedRestaurant.reviews[0].text || "Wonderful service and amazing environment — highly recommend!"}
                  </p>
                </div>
              )}

              {/* Service badge summary review attitude logic text */}
              <div className="mb-5 bg-[#141414] border border-[#2A2A2A] rounded-xl p-3.5 text-xs font-sans text-left space-y-1">
                <p className="font-medium text-[#F5F0E8]">
                  Management Attitude Badge:{" "}
                  <span
                    className={
                      selectedRestaurant.serviceAttitude === "ATTENTIVE"
                        ? "text-[#6FCF97]"
                        : selectedRestaurant.serviceAttitude === "STANDARD"
                        ? "text-[#F2C94C]"
                        : "text-[#5C5850]"
                    }
                  >
                    {selectedRestaurant.serviceAttitude || "UNKNOWN"}
                  </span>
                </p>
                <p className="text-[#9A9488] leading-normal text-[11px]">
                  {selectedRestaurant.serviceAttitude === "ATTENTIVE"
                    ? "The owners regularly respond to user feedback personally, prioritizing hospitality and hospitality excellence."
                    : selectedRestaurant.serviceAttitude === "STANDARD"
                    ? "Responses exist but generally follow standard templates."
                    : "No owner feedback was detected in the reviews."}
                </p>
              </div>

              {/* Maps static thumbnail */}
              <div
                onClick={() => openMapsUrl(selectedRestaurant)}
                className="w-full h-28 bg-[#141414] rounded-xl overflow-hidden border border-[#2A2A2A] mb-6 relative cursor-pointer group shrink-0"
              >
                <img
                  src={`/api/staticmap?lat=${selectedRestaurant.location.lat}&lng=${selectedRestaurant.location.lng}`}
                  alt="Static Map thumbnail"
                  className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-200"
                />
                <div className="absolute inset-0 bg-black/25 flex items-center justify-center gap-1.5 opacity-0 group-hover:opacity-100 transition-opacity">
                  <span className="bg-[#0D0D0D]/90 px-3 py-1.5 rounded-lg text-xs font-sans text-[#F5F0E8] border border-white/5 flex items-center gap-1">
                    <MapIcon className="h-3 w-3" /> Pin on Maps
                  </span>
                </div>
              </div>

              {/* Let's go dynamic deep-link button */}
              <button
                onClick={() => openMapsUrl(selectedRestaurant)}
                className="w-full bg-[#C8714A] hover:bg-[#D57B53] active:scale-[0.98] text-white py-4 rounded-xl font-sans text-sm font-semibold tracking-wider uppercase transition-all duration-150 flex items-center justify-center gap-2 shrink-0"
              >
                Let's Go <ExternalLink className="h-4 w-4" />
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
