import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import SortableStopCard from "@/components/SortableStopCard";
import EditStopModal from "@/components/EditStopModal";
import { useVoiceSearch } from "@/hooks/useVoiceSearch";
import RouteIntelligenceMultiIndex, { type SearchResult } from "@/lib/routeIntelligenceMultiIndex";
import RouteIntelligenceDebugger from "@/lib/routeIntelligenceDebugger";
import { riFeatureFlag } from "@/lib/routeIntelligenceFeatureFlag";
import { detectCorrection, createVoiceSearchContext, isWithinCorrectionWindow, normalizeTranscript, type VoiceSearchContext } from "@/lib/correctionDetection";
import { recordSearchEvent, type SearchEvent } from "@/lib/fieldTestingLogger";
import { Mic, MicOff, Search, X, Map, Printer, ArrowUpDown, Plus, Download, FlaskConical } from "lucide-react";
import { Link, useRoute } from "wouter";
import type { Stop } from "../../../drizzle/schema";
import {
  matchStop,
  matchStops,
  resolveSpokenName,
  splitPipe,
  rankMatchResults,
  countPrimaryEntityMatches,
} from "@/lib/matching";
import {
  DndContext,
  closestCenter,
  PointerSensor,
  TouchSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  verticalListSortingStrategy,
  arrayMove,
} from "@dnd-kit/sortable";
import { restrictToVerticalAxis } from "@dnd-kit/modifiers";
import { toast } from "sonner";
import FieldTestingDashboard from "@/components/FieldTestingDashboard";
import { SaveNameModal } from "@/components/SaveNameModal";
import { recordCorrection } from "@/lib/routeIntelligencePersistentLearning";

// ── Small inline plus button shown between stop cards in reorder mode ─────────
function InsertButton({
  label,
  onClick,
  disabled,
}: {
  label: string;
  onClick: () => void;
  disabled: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="w-full flex items-center justify-center gap-1.5 py-1 my-0.5 rounded-lg border border-dashed border-primary/25 text-primary/60 text-xs font-semibold hover:border-primary/60 hover:text-primary hover:bg-primary/5 transition-all disabled:opacity-40"
    >
      <Plus size={12} />
      {label}
    </button>
  );
}

// ── Extract the dominant surname from a query for multi-match announcement ────
function extractSurname(q: string): string {
  const words = q.trim().split(/\s+/);
  return words[words.length - 1] ?? q;
}

// ── Field test mode persists across reloads so a tester doesn't have to
// re-enable it every session; read once at module scope guarded for SSR. ────
const FIELD_TEST_MODE_STORAGE_KEY = "routelog:fieldTestMode";

function readPersistedFieldTestMode(): boolean {
  if (typeof localStorage === "undefined") return false;
  try {
    return localStorage.getItem(FIELD_TEST_MODE_STORAGE_KEY) === "true";
  } catch {
    return false;
  }
}

// ── Route Intelligence fuzzy/phonetic/learned search ──────────────────────────
// Minimum confidence to trust an RI result over (or ahead of) the deterministic
// matching.ts hierarchy. Exact/phonetic index hits land at 0.85-0.98; a single
// unconfirmed learned mapping is only 0.60 (see routeIntelligencePersistentLearning.ts) —
// set high enough that one unconfirmed correction can't hijack a search, but low
// enough that a 3rd+ confirmation (0.80+) or a real index match fires.
const RI_CONFIDENCE_THRESHOLD = 0.8;

/**
 * Resolve a Route Intelligence SearchResult's stopId to an actual Stop in the
 * current search pool. Returns null (and warns) instead of crashing when the
 * stopId doesn't resolve — this happens for manually-saved "no match" entries
 * from SaveNameModal, which persist a placeholder stopId of 0.
 */
function resolveRiStop(pool: Stop[], stopId: number): Stop | null {
  if (!stopId || stopId <= 0) {
    console.warn("[RI] Learned mapping resolved to a placeholder stopId — ignoring", stopId);
    return null;
  }
  const stop = pool.find(s => s.id === stopId);
  if (!stop) {
    console.warn("[RI] Learned mapping stopId not found in current search pool — ignoring", stopId);
    return null;
  }
  return stop;
}

/**
 * Walk RI's confidence-sorted results and return the first one that resolves
 * within the current search pool. The engine's dictionary spans the whole
 * route, so in DELIVERY mode (pool scoped to the current box) the single
 * top-confidence result may belong to a different box — that shouldn't
 * discard the whole RI attempt if a lower-ranked result resolves in-pool.
 * Results are sorted by confidence descending, so it's safe to stop as soon
 * as confidence drops below threshold.
 */
function resolveFirstConfidentRiMatch(results: SearchResult[], pool: Stop[]): Stop | null {
  for (const result of results) {
    if (result.confidence < RI_CONFIDENCE_THRESHOLD) break;
    const stop = resolveRiStop(pool, result.stopId);
    if (stop) return stop;
  }
  return null;
}

export default function RouteView() {
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";

  const [match, params] = useRoute("/route/:id");
  const routeIdParam = params?.id ? parseInt(params.id) : undefined;
  const { data: route } = trpc.routes.get.useQuery(
    { id: routeIdParam ?? 0 },
    { enabled: routeIdParam !== undefined }
  );
  const routeId = route?.id ?? 0;

  const { data: sections = [] } = trpc.sections.list.useQuery(
    { routeId },
    { enabled: routeId > 0 }
  );

  const [activeSectionId, setActiveSectionId] = useState<number | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [voiceError, setVoiceError] = useState<string | null>(null);
  const [editingStop, setEditingStop] = useState<Stop | null>(null);
  const [isNewStop, setIsNewStop] = useState(false);
  const [localStops, setLocalStops] = useState<Stop[]>([]);
  const [dragMode, setDragMode] = useState(false);
  const [appMode, setAppMode] = useState<'parcel' | 'sorting' | 'delivery'>('sorting');
  const [deliveryManifestId, setDeliveryManifestId] = useState<number | null>(null);
  const [riEngine, setRiEngine] = useState<RouteIntelligenceMultiIndex | null>(null);
  const [riDebugger] = useState(() => new RouteIntelligenceDebugger(riFeatureFlag.isEnabled()));
  const [riEnabled, setRiEnabled] = useState(riFeatureFlag.isEnabled());
  const [lastVoiceContext, setLastVoiceContext] = useState<VoiceSearchContext | null>(null);
  const [fieldTestMode, setFieldTestMode] = useState(readPersistedFieldTestMode);
  const [searchStartTime, setSearchStartTime] = useState<number | null>(null);
  const [saveNameModalOpen, setSaveNameModalOpen] = useState(false);
  const [lastFailedVoiceTranscript, setLastFailedVoiceTranscript] = useState<string>("");

  // Reorder/add/delete are admin-only — if a session expires while drag mode
  // is on, drop back to the read-only view instead of leaving edit UI stuck open.
  useEffect(() => {
    if (!isAdmin && dragMode) {
      setDragMode(false);
    }
  }, [isAdmin, dragMode]);

  useEffect(() => {
    if (sections.length > 0 && activeSectionId === null) {
      setActiveSectionId(sections[0].id);
    }
  // Only run when sections first load (length changes) — not when activeSectionId changes
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sections.length]);

  // Persist field test mode so a tester doesn't need to re-enable it every session
  useEffect(() => {
    try {
      localStorage.setItem(FIELD_TEST_MODE_STORAGE_KEY, String(fieldTestMode));
    } catch {
      // localStorage unavailable (private browsing, quota) — fieldTestMode still works in-memory
    }
  }, [fieldTestMode]);

  const toggleFieldTestMode = useCallback(() => {
    setFieldTestMode(v => {
      const next = !v;
      toast.success(next ? "Field test logging enabled" : "Field test logging disabled");
      return next;
    });
  }, []);

  const currentSectionId = activeSectionId ?? sections[0]?.id ?? 0;

  // Section-scoped stops for normal browsing and drag/reorder
  const { data: fetchedStops = [], isLoading: stopsLoading } = trpc.stops.listBySection.useQuery(
    { sectionId: currentSectionId },
    { enabled: currentSectionId > 0 }
  );

  // Route-wide stops for global voice/text search
  const { data: allRouteStops = [] } = trpc.stops.listAll.useQuery(
    { routeId },
    { enabled: routeId > 0 }
  );

  // Initialize Route Intelligence when route loads
  useEffect(() => {
    if (routeId > 0 && allRouteStops.length > 0) {
      console.time("[RI] Initialize");
      const engine = new RouteIntelligenceMultiIndex(routeId);
      engine.buildDictionary(allRouteStops as Stop[]);
      setRiEngine(engine);
      console.timeEnd("[RI] Initialize");
    }
  }, [routeId, allRouteStops.length]);

  // Merge fetchedStops into localStops only when section changes (not on every render)
  // localStops holds optimistic updates; fetchedStops is the server truth
  const prevSectionRef = useRef<number>(0);
  useEffect(() => {
    if (currentSectionId !== prevSectionRef.current) {
      prevSectionRef.current = currentSectionId;
      setLocalStops(fetchedStops as Stop[]);
    }
  }, [currentSectionId, fetchedStops]);

  // Also sync when fetchedStops first loads (localStops is empty)
  useEffect(() => {
    if (localStops.length === 0 && fetchedStops.length > 0) {
      setLocalStops(fetchedStops as Stop[]);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fetchedStops.length]);

  const stops = localStops.length > 0 ? localStops : (fetchedStops as Stop[]);

  // When a query is active, search ALL route stops; otherwise show current section only
  const isSearchActive = searchQuery.trim().length > 0;

  // Search pool: DELIVERY mode scopes to the current section (box);
  // SORTING/PARCEL modes search the entire route. Shared by the matcher
  // and the status text below so the displayed count never lies about scope.
  const searchPool = appMode === 'delivery' ? stops : (allRouteStops as Stop[]);

  // matchStops result memo — drives both visual filter and speech callback
  const matchResult = useMemo(() => {
    if (!isSearchActive) return null;
    const q = searchQuery.trim();
    return matchStops(searchPool, q);
  }, [isSearchActive, searchPool, searchQuery]);

  const rankedMatchStops = useMemo(() => {
    if (!isSearchActive || !matchResult) return stops;
    // Rank results so primary-entity matches (card title = query) appear first.
    // Secondary-list inclusions (name buried in a business resident list) appear below.
    return rankMatchResults(matchResult.results, searchQuery);
  }, [isSearchActive, matchResult, stops, searchQuery]);

  // Route Intelligence fuzzy/phonetic/learned lookup for the visual filter.
  // Runs alongside the synchronous matching.ts pass above (which renders
  // immediately) and, once resolved, promotes its match to the top of the
  // list if matching.ts didn't already surface it. Never replaces or delays
  // the deterministic result — only supplements it.
  const [riVisualMatch, setRiVisualMatch] = useState<Stop | null>(null);

  useEffect(() => {
    setRiVisualMatch(null);
    if (!isSearchActive || !riEngine || !riFeatureFlag.isEnabled()) return;

    let cancelled = false;
    const q = searchQuery.trim();
    riEngine.search(q)
      .then(results => {
        if (cancelled) return;
        const stop = resolveFirstConfidentRiMatch(results, searchPool);
        if (stop) setRiVisualMatch(stop);
      })
      .catch(err => console.warn("[RI] Visual search failed:", err));

    return () => { cancelled = true; };
  }, [isSearchActive, riEngine, searchPool, searchQuery]);

  const filteredStops = useMemo(() => {
    if (!isSearchActive) return stops;
    if (riVisualMatch && !rankedMatchStops.some(s => s.id === riVisualMatch.id)) {
      return [riVisualMatch, ...rankedMatchStops];
    }
    return rankedMatchStops;
  }, [isSearchActive, rankedMatchStops, stops, riVisualMatch]);

  const activeSection = sections.find(s => s.id === currentSectionId);

  // ── dnd-kit sensors ───────────────────────────────────────────────────────
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 8 } })
  );

  const utils = trpc.useUtils();

  const reorderMutation = trpc.stops.reorder.useMutation({
    onError: () => {
      toast.error("Reorder failed — refreshing");
      utils.stops.listBySection.invalidate({ sectionId: currentSectionId });
    },
  });

  const deleteStopMutation = trpc.stops.delete.useMutation();

  const addStopMutation = trpc.stops.add.useMutation({
    onSuccess: (newStop) => {
      if (newStop) {
        const stop = newStop as Stop;
        setLocalStops(prev => {
          const idx = prev.findIndex(s => s.stopOrder >= stop.stopOrder);
          if (idx === -1) return [...prev, stop];
          const next = [...prev];
          next.splice(idx, 0, stop);
          return next;
        });
        setIsNewStop(true);
        setEditingStop(stop);
      }
    },
    onError: () => toast.error("Could not add stop"),
  });

  const handleDragEnd = useCallback((event: DragEndEvent) => {
    if (!isAdmin) return;
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    setLocalStops(prev => {
      const oldIndex = prev.findIndex(s => s.id === active.id);
      const newIndex = prev.findIndex(s => s.id === over.id);
      if (oldIndex === -1 || newIndex === -1) return prev;

      const reordered = arrayMove(prev, oldIndex, newIndex).map((s, i) => ({
        ...s,
        stopOrder: i + 1,
      }));

      reorderMutation.mutate({
        sectionId: currentSectionId,
        orderedIds: reordered.map(s => s.id),
      });

      return reordered;
    });
  }, [isAdmin, currentSectionId, reorderMutation]);

  const handleAddStop = useCallback((insertAfterOrder?: number) => {
    if (!isAdmin || !activeSection) return;
    addStopMutation.mutate({ sectionId: currentSectionId, routeId, insertAfterOrder });
  }, [isAdmin, activeSection, currentSectionId, routeId, addStopMutation]);

  // ── Voice state machine ───────────────────────────────────────────────────
  // Reset speech state when section changes
  useEffect(() => {
    window.speechSynthesis?.cancel();
  }, [currentSectionId]);

  /**
   * Speak text via SpeechSynthesis.
   * 1. Notifies the hook to hard-abort recognition before speaking.
   * 2. Calls notifySpeakingEnd() inside utterance.onend so recognition restarts
   *    ONLY after speech has fully finished.
   */
  const speakAndResume = useCallback((
    text: string,
    onDone?: () => void
  ) => {
    if (!("speechSynthesis" in window)) {
      onDone?.();
      return;
    }

    // Abort recognition before speaking (mic + speaker conflict on iOS)
    notifySpeakingStart();
    
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = "en-IE";
    utterance.rate = 0.95;

    // On mobile (iPhone/iPad/Android), the speaker and mic are close enough that
    // ANY spoken output gets picked up as a new voice query regardless of mode.
    // Always pass text length on mobile so notifySpeakingEnd can calculate the right delay.
    const isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);
    const spokenLen = isMobile ? text.length : 0;

    // Safety: track whether onend/onerror fired. On iOS, utterance.onend can silently
    // fail if the audio session is interrupted, leaving the mic stuck in 'speaking' forever.
    let endFired = false;
    const safeEnd = () => {
      if (endFired) return;
      endFired = true;
      onDone?.();
      notifySpeakingEnd(spokenLen);
    };

    utterance.onend = () => {
      console.debug("[Voice] utterance.onend");
      safeEnd();
    };
    utterance.onerror = (e: SpeechSynthesisErrorEvent) => {
      console.warn("[Voice] utterance.onerror", e);
      safeEnd();
    };
    utterance.onstart = () => {
      console.debug("[Voice] utterance.onstart");
    };

    console.debug("[Voice] speak:", text);

    // Estimate speech duration: ~80ms per character at rate 0.95, min 600ms, max 4000ms
    const estimatedSpeechMs = Math.min(4000, Math.max(600, text.length * 80));
    // Fallback: if onend never fires (iOS audio session issue), force-restart after 2x estimated duration
    const fallbackTimer = setTimeout(() => {
      console.warn("[Voice] utterance.onend never fired — forcing mic restart");
      safeEnd();
    }, 150 + estimatedSpeechMs * 2);

    // Clear fallback timer if onend fires normally
    const origSafeEnd = safeEnd;
    utterance.onend = () => {
      clearTimeout(fallbackTimer);
      console.debug("[Voice] utterance.onend");
      origSafeEnd();
    };
    utterance.onerror = (e: SpeechSynthesisErrorEvent) => {
      clearTimeout(fallbackTimer);
      console.warn("[Voice] utterance.onerror", e);
      origSafeEnd();
    };

    // Single 100ms delay: cancel any stuck iOS utterance then speak immediately.
    // cancel() + speak() in the same tick is safe — iOS processes them sequentially.
    setTimeout(() => {
      window.speechSynthesis.cancel();
      window.speechSynthesis.speak(utterance);
    }, 100);
  // notifySpeakingStart and notifySpeakingEnd are stable refs from the hook
  // appMode is needed to determine the post-speech delay (delivery vs sorting/parcel)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [appMode]);

  /**
   * Build callback text based on mode:
   * - SORTING: name · route reference only (throwing up into boxes)
   * - DELIVERY: stop number only (delivering in stop order)
   * - PARCEL: name · route reference · stop number (parcel placement)
   */
  const buildStopSpeech = useCallback((
    stop: Stop,
    spokenName: string,
  ): string => {
    const parts: string[] = [];
    
    if (appMode === 'sorting') {
      // SORTING MODE: name + route reference only
      if (spokenName) parts.push(spokenName);
      if (stop.road) parts.push(stop.road);
    } else if (appMode === 'delivery') {
      // DELIVERY MODE: stop number only
      parts.push(`Stop ${stop.stopOrder}`);
    } else if (appMode === 'parcel') {
      // PARCEL MODE: name + route reference + stop number
      if (spokenName) parts.push(spokenName);
      if (stop.road) parts.push(stop.road);
      parts.push(`Stop ${stop.stopOrder}`);
    }
    
    return parts.join(". ");
  }, [appMode]);

  /**
   * Handle a transcript from the voice hook.
   * isFinal=true: stable result — process and speak.
   * isFinal=false: interim — update search bar only.
   */
  const handleVoiceTranscript = useCallback(async (text: string, isFinal: boolean) => {
    setSearchQuery(text);

    if (!isFinal) return;

    const q = text.trim();
    if (!q) return;

    // Track search start time for field testing
    if (fieldTestMode) {
      setSearchStartTime(Date.now());
    }

    // In DELIVERY mode, check for box switching commands first
    if (appMode === 'delivery') {
      const boxMatch = q.match(/^box\s+(\d+)$/i);
      if (boxMatch) {
        const boxNum = parseInt(boxMatch[1]);
        const targetSection = sections.find(s => s.boxNumber === boxNum);
        if (targetSection) {
          setActiveSectionId(targetSection.id);
          setSearchQuery("");
          speakAndResume(`Box ${boxNum} ready. ${targetSection.name}.`);
          return;
        } else {
          speakAndResume(`Box ${boxNum} not found.`);
          return;
        }
      }

      const nextBoxMatch = q.match(/^next\s+box$/i);
      if (nextBoxMatch) {
        const currentIdx = sections.findIndex(s => s.id === currentSectionId);
        if (currentIdx >= 0 && currentIdx < sections.length - 1) {
          const nextSection = sections[currentIdx + 1]!;
          setActiveSectionId(nextSection.id);
          setSearchQuery("");
          speakAndResume(`Box ${nextSection.boxNumber} ready. ${nextSection.name}.`);
          return;
        } else {
          speakAndResume("No next box.");
          return;
        }
      }
    }

    // In DELIVERY mode, search only the current section (box).
    // In SORTING/PARCEL modes, search the entire route.
    let pool: Stop[];
    if (appMode === 'delivery') {
      // Delivery mode: scope search to current section only
      pool = stops; // stops = section-scoped stops
      if (pool.length === 0) return;
    } else {
      // Sorting/Parcel modes: search entire route
      if (allRouteStops.length === 0) return;
      pool = allRouteStops as Stop[];
    }

    // Route Intelligence: try the fuzzy/phonetic/learned-mapping engine first.
    // A confident hit here means the speaker's pronunciation didn't match any
    // exact substring/alias but was recognised anyway — speak it immediately
    // and skip the deterministic hierarchy below. Gated behind riFeatureFlag
    // so it can be switched off instantly without a redeploy if it misfires.
    if (riEngine && riFeatureFlag.isEnabled()) {
      try {
        const riResults = await riEngine.search(q);
        const stop = resolveFirstConfidentRiMatch(riResults, pool);
        if (stop) {
          const result = matchStop(stop, q);
          const spokenName = resolveSpokenName(stop, result);
          const speech = buildStopSpeech(stop, spokenName);
          // matchLevel 3 ("broad/fuzzy") is the closest honest label for a
          // non-exact RI resolution — field-test stats key off this level
          // to report fuzzyMatchingUsed.
          setLastVoiceContext(createVoiceSearchContext(q, 3, [stop]));
          speakAndResume(speech);
          return;
        }
      } catch (err) {
        console.warn("[RI] Voice search failed, falling back to matching.ts:", err);
      }
    }

    // Use the same matchStops 3-level hierarchy as the visual filter.
    // level 1 = exact phrase match (residents/businessName)
    // level 2 = exact alias phrase match
    // level 3 = broad token fallback (or single-word)
    const { level, results } = matchStops(pool, q);

    // Determine if this is a multi-word (strict full-name intent) query
    const isMultiWord = q.trim().split(/\s+/).filter(Boolean).length >= 2;

    // Capture voice context for learning system
    // This allows us to detect when user manually selects a stop after no exact match
    const voiceContext = createVoiceSearchContext(q, level, results);
    setLastVoiceContext(voiceContext);

    if (results.length === 0) {
      // Zero results:
      // - Multi-word: strict intent failed — speak specific "No exact match" message
      // - Single-word: nothing matched at all
      if (isMultiWord) {
        speakAndResume(`No exact match found for ${q}`);
      } else {
        speakAndResume(`No match for ${q}`);
      }
      // Trigger save name modal so user can save this failed search
      setLastFailedVoiceTranscript(q);
      setSaveNameModalOpen(true);
    } else if (level === 1 || level === 2) {
      // Exact phrase or alias phrase match.
      // Use primary-entity count to decide callback:
      //   - Exactly 1 primary-entity match → speak full callback immediately
      //     (even if other secondary-list matches exist in results)
      //   - 2+ primary-entity matches → speak "Multiple X matches found"
      //   - 0 primary-entity matches (all are secondary-list inclusions) →
      //     speak full callback of the first (and likely only) result
      const primaryCount = countPrimaryEntityMatches(results, q);

      if (primaryCount === 1) {
        // Find the single primary-entity match and speak it
        const rankedResults = rankMatchResults(results, q);
        const stop = rankedResults[0]!;
        const result = matchStop(stop, q);
        const spokenName = resolveSpokenName(stop, result);
        const speech = buildStopSpeech(stop, spokenName);
        speakAndResume(speech);
      } else if (primaryCount >= 2) {
        // Multiple primary-entity matches — announce ambiguity
        const surname = extractSurname(q);
        speakAndResume(`Multiple ${surname} matches found`);
      } else {
        // No primary-entity match but secondary matches exist (e.g. name in
        // a business resident list). Speak the first result's full callback.
        const stop = results[0]!;
        const result = matchStop(stop, q);
        const spokenName = resolveSpokenName(stop, result);
        const speech = buildStopSpeech(stop, spokenName);
        speakAndResume(speech);
      }
    } else {
      // Level 3: broad token fallback
      // In DELIVERY mode: speak the stop number anyway (postman needs quick feedback)
      // In SORTING/PARCEL modes: say "Closest matches shown" per spec
      if (appMode === 'delivery' && results.length > 0) {
        const stop = results[0]!;
        const result = matchStop(stop, q);
        const spokenName = resolveSpokenName(stop, result);
        const speech = buildStopSpeech(stop, spokenName);
        speakAndResume(speech);
      } else {
        speakAndResume("Closest matches shown");
      }
    }
  // appMode controls search scope (delivery vs sorting/parcel)
  // stops and allRouteStops must be in deps to avoid stale closure (empty pool)
  // setLastVoiceContext must be in deps to capture voice context for learning
  // riEngine must be in deps so the RI-first attempt uses the current engine instance
  }, [buildStopSpeech, speakAndResume, appMode, stops, allRouteStops, currentSectionId, sections, setLastVoiceContext, riEngine]);

  const {
    voiceState,
    listening,
    toggle: toggleVoiceRaw,
    notifySpeakingStart,
    notifySpeakingEnd,
    primeAudioContext,
  } = useVoiceSearch(handleVoiceTranscript, (e) => setVoiceError(e));

  // Wrap toggle to clear search on stop
  const toggleVoice = useCallback(() => {
    if (listening || voiceState === "speaking") {
      toggleVoiceRaw();
      setSearchQuery("");
      window.speechSynthesis?.cancel();
    } else {
      toggleVoiceRaw();
    }
  }, [listening, voiceState, toggleVoiceRaw]);

  // Handle mode switching
  const handleModeChange = useCallback((newMode: 'parcel' | 'sorting' | 'delivery') => {
    setAppMode(newMode);
    setSearchQuery("");
    window.speechSynthesis?.cancel();
    if (newMode === 'delivery') {
      // In delivery mode, default to first section
      setDeliveryManifestId(sections[0]?.id ?? null);
    } else {
      setDeliveryManifestId(null);
    }
  }, [sections]);

  // Handle onPointerDown for iOS gesture requirement
  const handleVoicePointerDown = useCallback(() => {
    console.debug("[Voice] onPointerDown triggered — priming audio context and toggling voice");
    primeAudioContext();
    toggleVoice();
  }, [primeAudioContext, toggleVoice]);

  const tabsRef = useRef<HTMLDivElement>(null);

  const scrollTabIntoView = (id: number) => {
    const el = tabsRef.current?.querySelector(`[data-section-id="${id}"]`);
    el?.scrollIntoView({ behavior: "smooth", inline: "center", block: "nearest" });
  };

  const handleSectionChange = (id: number) => {
    setActiveSectionId(id);
    setSearchQuery("");
    setDragMode(false);
    scrollTabIntoView(id);
    window.speechSynthesis?.cancel();
  };

  const handleExportLearnedMappings = useCallback(async () => {
    if (!riEngine) {
      toast.error("Route Intelligence engine not initialized");
      return;
    }

    try {
      const mappings = await riEngine.getPersistentLearnedMappings();
      if (mappings.length === 0) {
        toast.info("No learned mappings to export");
        return;
      }

      const exportData = {
        routeId,
        routeName: route?.name || "Unknown",
        exportedAt: new Date().toISOString(),
        totalMappings: mappings.length,
        mappings: mappings.map(m => ({
          originalTranscript: m.originalTranscript,
          normalizedTranscript: m.normalizedTranscript,
          stopId: m.stopId,
          confirmationCount: m.confirmationCount,
          confidence: Math.min(0.5 + m.confirmationCount * 0.1, 0.85),
          firstConfirmedAt: new Date(m.firstConfirmedAt).toISOString(),
          lastConfirmedAt: new Date(m.lastConfirmedAt).toISOString(),
        })),
      };

      const jsonString = JSON.stringify(exportData, null, 2);
      const blob = new Blob([jsonString], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `learned-mappings-${route?.name || "route"}-${new Date().toISOString().split("T")[0]}.json`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);

      toast.success(`Exported ${mappings.length} learned mappings`);
    } catch (err) {
      console.error("[Export] Failed to export learned mappings:", err);
      toast.error("Failed to export learned mappings");
    }
  }, [riEngine, routeId, route?.name]);

  const handleCardTap = useCallback((stop: Stop) => {
    // Opening the edit modal is admin-only. The voice-search correction
    // recording below must keep working for every postman regardless of
    // login, since tapping a search result is also how they confirm a
    // fuzzy/failed match — so it stays outside this check.
    if (isAdmin) {
      setIsNewStop(false);
      setEditingStop(stop);
    }

    // Check if this tap should trigger a learning correction
    // Only if: voice search just happened AND found no exact match AND user is selecting from results
    if (lastVoiceContext && isWithinCorrectionWindow(lastVoiceContext, Date.now())) {
      const correction = detectCorrection(lastVoiceContext, stop);
      if (correction.shouldRecord && riEngine) {
        // Record the correction asynchronously
        riEngine.recordPersistentCorrection(
          correction.transcript,
          stop.id,
          ["user-selected"]
        ).catch((err) => {
          console.warn("[Learning] Failed to record correction:", err);
        });
        console.debug("[Learning] Recorded correction:", {
          transcript: correction.transcript,
          stopId: stop.id,
          reason: correction.reason,
        });
      }

      // Log to field testing if enabled
      if (fieldTestMode && searchStartTime) {
        const responseTimeMs = Date.now() - searchStartTime;
        const topCandidate = lastVoiceContext.matchResults[0];
        const event: SearchEvent = {
          id: `${routeId}-${Date.now()}-${Math.random()}`,
          timestamp: Date.now(),
          routeId,
          originalTranscript: lastVoiceContext.transcript,
          normalizedTranscript: lastVoiceContext.normalizedTranscript,
          learnedMappingUsed: false, // Will be set by Route Intelligence if learned mapping was used
          fuzzyMatchingUsed: lastVoiceContext.matchLevel === 3, // Broad fallback = fuzzy matching
          topCandidates: lastVoiceContext.matchResults.slice(0, 5).map((s, idx) => ({
            stopId: s.id,
            stopName: s.residents || "Unknown",
            confidence: 1 - (idx * 0.1), // Rough confidence based on rank
            matchType: (idx === 0 && lastVoiceContext.matchLevel >= 1) ? "exact" : "fuzzy",
          })),
          selectedStopId: stop.id,
          selectedStopName: stop.residents || "Unknown",
          responseTimeMs,
          manualCorrectionMade: correction.shouldRecord,
          correctionFromStopId: topCandidate?.id,
          correctionToStopId: stop.id,
          appMode,
          sectionId: currentSectionId,
        };
        recordSearchEvent(event).catch((err) => {
          console.warn("[FieldTest] Failed to log search event:", err);
        });
        setSearchStartTime(null);
      }
    }
  }, [isAdmin, lastVoiceContext, riEngine, fieldTestMode, searchStartTime, routeId, appMode, currentSectionId]);

  const handleModalSaved = useCallback((updated: Stop) => {
    setLocalStops(prev => {
      const exists = prev.some(s => s.id === updated.id);
      return exists
        ? prev.map(s => s.id === updated.id ? updated : s)
        : [...prev, updated];
    });
    setEditingStop(null);
    setIsNewStop(false);
  }, []);

  const handleModalClose = useCallback(() => {
    if (isNewStop && editingStop) {
      deleteStopMutation.mutate({ id: editingStop.id });
      setLocalStops(prev => prev.filter(s => s.id !== editingStop.id));
    }
    setEditingStop(null);
    setIsNewStop(false);
  }, [isNewStop, editingStop, deleteStopMutation]);

  const handleDeleteStop = useCallback(async (stopId: number) => {
    if (!isAdmin) return;
    try {
      await deleteStopMutation.mutateAsync({ id: stopId });
      // Remove the stop and renumber remaining stops in the same section
      setLocalStops(prev => {
        const filtered = prev.filter(s => s.id !== stopId);
        // Find the section of the deleted stop
        const deletedStop = prev.find(s => s.id === stopId);
        if (!deletedStop) return filtered;
        // Renumber stops in the same section
        return filtered.map(s => {
          if (s.sectionId === deletedStop.sectionId && s.stopOrder > deletedStop.stopOrder) {
            return { ...s, stopOrder: s.stopOrder - 1 };
          }
          return s;
        });
      });
    } catch (error) {
      console.error("Failed to delete stop:", error);
      throw error;
    }
  }, [isAdmin, deleteStopMutation]);

  const displayStops = dragMode ? stops : filteredStops;

  return (
    <div className="min-h-screen bg-background flex flex-col">
      {/* ── Sticky header ── */}
      <header className="sticky top-0 z-20 bg-primary text-primary-foreground shadow-md no-print">
        {/* Title row */}
        <div className="flex items-center justify-between px-3 pt-3 pb-1.5">
          <div>
            <h1 className="text-base font-display font-bold leading-tight">{route?.name ?? "Route"}</h1>
            <p className="text-xs text-primary-foreground/70">
              {activeSection
                ? `Box ${activeSection.boxNumber} · ${activeSection.name}`
                : "Loading…"}
            </p>
          </div>
          <div className="flex items-center gap-1">
            {isAdmin && (
              <button
                onClick={() => { setDragMode(v => !v); setSearchQuery(""); }}
                title={dragMode ? "Exit reorder mode" : "Reorder stops"}
                className={`p-2 rounded-full transition-colors ${
                  dragMode
                    ? "bg-accent text-accent-foreground"
                    : "hover:bg-white/10"
                }`}
              >
                <ArrowUpDown size={17} />
              </button>
            )}
            <Link href="/map">
              <button className="p-2 rounded-full hover:bg-white/10 transition-colors" title="Map view">
                <Map size={17} />
              </button>
            </Link>
            <Link href="/print">
              <button className="p-2 rounded-full hover:bg-white/10 transition-colors" title="Print view">
                <Printer size={17} />
              </button>
            </Link>
            <button
              onClick={handleExportLearnedMappings}
              className="p-2 rounded-full hover:bg-white/10 transition-colors"
              title="Export learned mappings (JSON)"
            >
              <Download size={17} />
            </button>
            <button
              onClick={toggleFieldTestMode}
              title={fieldTestMode ? "Field test logging: ON — tap to disable" : "Field test logging: OFF — tap to enable"}
              className={`p-2 rounded-full transition-colors ${
                fieldTestMode
                  ? "bg-accent text-accent-foreground"
                  : "hover:bg-white/10"
              }`}
            >
              <FlaskConical size={17} />
            </button>
          </div>
        </div>

        {/* ── Section tabs ── */}
        <div
          ref={tabsRef}
          className="flex gap-1.5 overflow-x-auto scrollbar-hide px-3 pb-2"
        >
          {sections.map(sec => (
            <button
              key={sec.id}
              data-section-id={sec.id}
              onClick={() => handleSectionChange(sec.id)}
              className={`shrink-0 rounded-full px-3 py-1 text-xs font-semibold transition-all whitespace-nowrap ${
                sec.id === currentSectionId
                  ? "bg-accent text-accent-foreground shadow"
                  : "bg-white/10 text-primary-foreground hover:bg-white/20"
              }`}
            >
              {sec.boxNumber}. {sec.name}
            </button>
          ))}
        </div>

        {/* ── Search bar (hidden in drag mode) ── */}
        {!dragMode && (
          <div className="flex items-center gap-2 px-3 pb-2.5">
            <div className="relative flex-1">
              <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <input
                type="text"
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                placeholder="Search residents, aliases…"
                className="w-full pl-8 pr-8 py-1.5 rounded-full text-sm bg-white text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-accent"
              />
              {searchQuery && (
                <button
                  onClick={() => { setSearchQuery(""); window.speechSynthesis?.cancel(); }}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                >
                  <X size={14} />
                </button>
              )}
            </div>
            <button
              onPointerDown={handleVoicePointerDown}
              title={listening ? "Stop listening" : voiceState === "speaking" ? "Speaking…" : "Voice search"}
              className={`shrink-0 p-2 rounded-full transition-all ${
                listening
                  ? "bg-red-500 text-white animate-pulse"
                  : voiceState === "speaking"
                  ? "bg-accent text-accent-foreground animate-pulse"
                  : "bg-white/20 text-primary-foreground hover:bg-white/30"
              }`}
            >
              {listening ? <MicOff size={16} /> : <Mic size={16} />}
            </button>
            <button
              onPointerDown={() => {
                const u = new SpeechSynthesisUtterance(" ");
                u.volume = 0;
                window.speechSynthesis.speak(u);
              }}
              onClick={() => {
                const u = new SpeechSynthesisUtterance(" ");
                u.volume = 0;
                window.speechSynthesis.speak(u);
              }}
              title="One-time iOS audio unlock"
              className="shrink-0 px-2 py-1 rounded-full bg-yellow-500 text-white hover:bg-yellow-600 active:bg-yellow-700 transition-colors text-xs font-bold pointer-events-auto z-10"
            >
              Audio
            </button>
          </div>
        )}

        {dragMode && (
          <div className="px-3 pb-2.5">
            <p className="text-xs text-primary-foreground/70 text-center">
              Drag handles to reorder · tap ⇅ again to exit
            </p>
          </div>
        )}

        {/* Mode selector */}
        {!dragMode && (
          <div className="flex gap-1.5 px-3 pb-2.5">
            {(['sorting', 'delivery', 'parcel'] as const).map(mode => (
              <button
                key={mode}
                onClick={() => handleModeChange(mode)}
                className={`flex-1 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                  appMode === mode
                    ? 'bg-accent text-accent-foreground shadow'
                    : 'bg-white/10 text-primary-foreground hover:bg-white/20'
                }`}
              >
                {mode.charAt(0).toUpperCase() + mode.slice(1)}
              </button>
            ))}
          </div>
        )}

        {voiceError && !dragMode && (
          <p className="text-xs text-red-300 px-3 pb-1">{voiceError}</p>
        )}
      </header>

      {/* ── Active box banner (Delivery mode only) ── */}
      {appMode === 'delivery' && activeSection && (
        <div className="px-3 py-2.5 bg-accent/10 border-b border-accent/20">
          <p className="text-sm font-semibold text-accent">
            📍 Box {activeSection.boxNumber} Ready — {activeSection.name}
          </p>
        </div>
      )}

      {/* ── Stop count ── */}
      <div className="px-3 py-2 text-xs text-muted-foreground no-print">
        {stopsLoading ? "Loading…" : (
          <>
            {dragMode
              ? `${stops.length} stops — drag to reorder`
              : isSearchActive
              ? `${filteredStops.length} of ${searchPool.length} stops ${appMode === 'delivery' ? 'in this box' : 'across route'} matching "${searchQuery}"`
              : `${stops.length} stops in this section`
            }
          </>
        )}
      </div>

      {/* ── Stop list ── */}
      <main className="flex-1 px-3 pb-6 space-y-2">
        {stopsLoading ? (
          <div className="space-y-2">
            {[...Array(6)].map((_, i) => (
              <div key={i} className="h-20 bg-white rounded-xl border animate-pulse" />
            ))}
          </div>
        ) : displayStops.length === 0 ? (
          <div className="text-center py-12 text-muted-foreground">
            <p className="text-sm">No stops found</p>
            {searchQuery && (
              <button onClick={() => setSearchQuery("")} className="mt-2 text-xs text-primary underline">
                Clear search
              </button>
            )}
          </div>
        ) : dragMode && isAdmin ? (
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            modifiers={[restrictToVerticalAxis]}
            onDragEnd={handleDragEnd}
          >
            <SortableContext
              items={displayStops.map(s => s.id)}
              strategy={verticalListSortingStrategy}
            >
              {/* Insert before first stop */}
              <InsertButton
                label="+ Add stop at top"
                onClick={() => handleAddStop(0)}
                disabled={addStopMutation.isPending}
              />
              {displayStops.map((stop, idx) => (
                <div key={stop.id}>
                  <SortableStopCard
                    stop={stop}
                    searchQuery=""
                    onTap={handleCardTap}
                    isDragMode={true}
                    isAdmin={isAdmin}
                    onDelete={handleDeleteStop}
                  />
                  {/* Insert after this stop */}
                  <InsertButton
                    label={idx === displayStops.length - 1 ? "+ Add stop at end" : "+ Insert here"}
                    onClick={() => handleAddStop(stop.stopOrder)}
                    disabled={addStopMutation.isPending}
                  />
                </div>
              ))}
            </SortableContext>
          </DndContext>
        ) : (
          displayStops.map(stop => {
            // In global search mode, show a section label above each card
            // so the postman knows which section the result belongs to
            const stopSec = isSearchActive
              ? sections.find(s => s.id === stop.sectionId)
              : null;
            return (
              <div key={stop.id}>
                {stopSec && (
                  <p className="text-xs font-semibold text-primary/60 px-1 pt-1 pb-0.5">
                    Box {stopSec.boxNumber} · {stopSec.name}
                  </p>
                )}
                <SortableStopCard
                  stop={stop}
                  searchQuery={searchQuery}
                  onTap={handleCardTap}
                  isDragMode={false}
                  isAdmin={isAdmin}
                  onDelete={dragMode && isAdmin ? handleDeleteStop : undefined}
                />
              </div>
            );
          })
        )}

        {!dragMode && (
          <p className="text-center text-xs text-muted-foreground/50 mt-2 pb-2">
            {isSearchActive
              ? appMode === 'delivery'
                ? `Searching ${searchPool.length} stops in this box`
                : `Searching all ${searchPool.length} stops across the route`
              : activeSection ? "Tap ⇅ to enter reorder mode and insert stops at any position" : ""}
          </p>
        )}
      </main>

      {/* ── Save Name Modal ── */}
      <SaveNameModal
        isOpen={saveNameModalOpen}
        onClose={() => setSaveNameModalOpen(false)}
        onSave={async (transcript, stopId, stopName) => {
          await recordCorrection(
            routeId,
            stopId,
            transcript,
            normalizeTranscript(transcript)
          );
          toast.success(`Saved: "${transcript}" → ${stopName}`);
        }}
        voiceTranscript={lastFailedVoiceTranscript}
        stops={localStops}
      />

      {/* ── Edit / Create modal ── */}
      {editingStop && activeSection && (
        <EditStopModal
          stop={editingStop}
          sectionName={activeSection.name}
          boxNumber={activeSection.boxNumber}
          onClose={handleModalClose}
          onSaved={handleModalSaved}
          isNew={isNewStop}
        />
      )}
    </div>
  );
}
