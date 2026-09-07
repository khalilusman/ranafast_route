import type { Stop } from "../../../drizzle/schema";
import { splitPipe, normalise, bestResidentIndex } from "@/lib/matching";

interface StopCardProps {
  stop: Stop;
  searchQuery?: string;
  onTap?: (stop: Stop) => void;
  isAdmin?: boolean;
}

function SideBadge({ side }: { side: string | null | undefined }) {
  if (!side) return null;
  const s = side.trim().toLowerCase();
  if (s === "left" || s === "l") {
    return (
      <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-bold bg-blue-100 text-blue-800">
        L
      </span>
    );
  }
  if (s === "right" || s === "r") {
    return (
      <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-bold bg-emerald-100 text-emerald-800">
        R
      </span>
    );
  }
  return (
    <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold bg-gray-100 text-gray-600">
      {side}
    </span>
  );
}

function PropertyBadge({ type }: { type: string | null | undefined }) {
  if (!type) return null;
  const t = type.trim();
  const colours: Record<string, string> = {
    Residential:     "bg-slate-100 text-slate-600",
    Business:        "bg-purple-100 text-purple-700",
    "Holiday House": "bg-sky-100 text-sky-700",
    Vacant:          "bg-orange-100 text-orange-700",
  };
  const cls = colours[t] ?? "bg-gray-100 text-gray-600";
  return (
    <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-xs ${cls}`}>
      {t}
    </span>
  );
}

/**
 * Filter out aliases that are just a bare surname already present in the
 * residents list. These add no value and pollute the alias display.
 * e.g. if residents = ["Sean Doran", "Sylvia Doran"] and aliases = ["Doran"],
 * "Doran" is stripped because it is a single token that matches a resident surname.
 */
function filterAliases(aliases: string[], residents: string[]): string[] {
  const residentSurnames = new Set(
    residents.flatMap(r => {
      const parts = r.trim().split(/\s+/);
      return parts.length >= 2 ? [normalise(parts[parts.length - 1]!)] : [];
    })
  );
  return aliases.filter(alias => {
    const tokens = alias.trim().split(/\s+/).filter(Boolean);
    // Strip if it's a single token that exactly matches a resident surname
    if (tokens.length === 1) {
      return !residentSurnames.has(normalise(tokens[0]!));
    }
    return true;
  });
}

export default function StopCard({ stop, searchQuery = "", onTap, isAdmin = false }: StopCardProps) {
  const residents  = splitPipe(stop.residents);
  const rawAliases = splitPipe(stop.aliases);
  // Strip surname-only aliases (e.g. "Doran" when residents include "Sean Doran")
  const aliases    = filterAliases(rawAliases, residents);
  const isBusiness = stop.propertyType === "Business";

  // For business stops, businessName is the primary heading
  // For residential/other stops, promote the matched resident
  const matchIdx = bestResidentIndex(stop, searchQuery);
  const primaryResident = residents[matchIdx] ?? residents[0] ?? "";
  const otherResidents  = residents.filter((_, i) => i !== matchIdx);

  const isSearchActive = searchQuery.trim().length > 0;

  // Address line: houseName / houseNumber / road
  const addressParts = [stop.houseName, stop.houseNumber, stop.road].filter(Boolean);

  return (
    <div
      // Editing (button semantics, hover/cursor affordance, the tap-to-edit
      // hint below) is admin-only. The onClick itself stays wired for every
      // visitor regardless: tapping a search result after a voice/text search
      // miss is also how postmen confirm a correction, and that must keep
      // working with no login — see routeIntelligencePersistentLearning.ts.
      role={isAdmin ? "button" : undefined}
      tabIndex={isAdmin ? 0 : undefined}
      onClick={() => onTap?.(stop)}
      onKeyDown={isAdmin ? (e => { if (e.key === "Enter" || e.key === " ") onTap?.(stop); }) : undefined}
      className={`bg-white rounded-xl border shadow-sm px-3 py-3 transition-all select-none ${
        isAdmin ? "active:scale-[0.98] cursor-pointer" : ""
      } ${
        isSearchActive
          ? "ring-2 ring-primary/30 border-primary/30"
          : isAdmin
          ? "border-border hover:border-primary/30 hover:shadow-md"
          : "border-border"
      }`}
    >
      {/* ── Row 1: stop number · side · type · dog · drop-off · eircode ── */}
      <div className="flex items-center gap-1.5 mb-2 flex-wrap">
        <span className="text-xs font-bold text-muted-foreground shrink-0 min-w-[1.5rem]">
          #{stop.stopOrder}
        </span>
        <SideBadge side={stop.side} />
        <PropertyBadge type={stop.propertyType} />
        {stop.hasDog && (
          <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-xs font-bold bg-red-100 text-red-700">
            🐕 Dog Warning
          </span>
        )}
        {stop.safePlace && (
          <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-xs font-semibold bg-yellow-100 text-yellow-800">
            📦 Drop-Off
          </span>
        )}
        {stop.eircode && (
          <span className="ml-auto text-xs text-muted-foreground font-mono shrink-0">
            {stop.eircode}
          </span>
        )}
      </div>

      {/* ── Row 2: PRIMARY heading ── */}
      {isBusiness && stop.businessName ? (
        <>
          {/* Business name is the primary callback target */}
          <p className="text-[17px] font-bold text-foreground leading-snug">
            {stop.businessName}
          </p>
          {/* Contact/resident names shown below as secondary */}
          {residents.length > 0 && (
            <p className="mt-0.5 text-sm text-muted-foreground leading-snug">
              {residents.join(", ")}
            </p>
          )}
        </>
      ) : (
        <>
          {/* Residential/other: primary resident bold, others muted */}
          {primaryResident && (
            <p className="text-[17px] font-bold text-foreground leading-snug">
              {primaryResident}
            </p>
          )}
          {otherResidents.length > 0 && (
            <p className="mt-0.5 text-sm text-muted-foreground leading-snug">
              {otherResidents.join(", ")}
            </p>
          )}
        </>
      )}

      {/* ── Row 4: aliases ── */}
      {aliases.length > 0 && (
        <p className="mt-1 text-xs text-muted-foreground/80 italic">
          Also: {aliases.join(", ")}
        </p>
      )}

      {/* ── Row 5: address ── */}
      {addressParts.length > 0 && (
        <p className="mt-1 text-xs text-muted-foreground">
          {addressParts.join(", ")}
        </p>
      )}

      {/* ── Row 5b: route reference label ── */}
      {stop.road && (
        <p className="mt-0.5 text-[11px] text-muted-foreground/60">
          <span className="font-semibold uppercase tracking-wide">Route Ref:</span> {stop.road}
        </p>
      )}

      {/* ── Row 6: parcel drop-off detail ── */}
      {stop.safePlace && (
        <p className="mt-1.5 text-xs font-medium text-yellow-900 bg-yellow-50 border border-yellow-200 rounded-md px-2 py-1">
          Parcel drop-off: {stop.safePlace}
        </p>
      )}

      {/* ── Row 7: notes — hidden in sort/search mode ── */}
      {stop.notes && !isSearchActive && (
        <p className="mt-1.5 text-xs text-slate-700 bg-slate-50 border border-slate-200 rounded-md px-2 py-1">
          {stop.notes}
        </p>
      )}

      {/* ── Tap hint (admin only) ── */}
      {isAdmin && onTap && (
        <div className="mt-2 flex justify-end">
          <span className="text-[10px] text-muted-foreground/50">tap to edit</span>
        </div>
      )}
    </div>
  );
}
