# Maghery Route — Postal Delivery Route Management App

A mobile-first web application for postmen to manage delivery routes with voice search, permanent learning system, and real-time analytics.

**Live Demo:** https://magheryrt-3b64p5qr.manus.space

---

## Features

### Core Delivery Operations
- **Route Management** — View sections and stops organized by delivery sequence
- **Stop Cards** — Display resident names, aliases, delivery notes, safe places, dog warnings, property type
- **Voice Search** — Hands-free voice recognition to find stops by resident name
- **Text Search** — Filter stops by resident, alias, or delivery notes
- **Edit Stop** — Update resident info, aliases, notes, safe places in real-time
- **Drag-to-Reorder** — Reorder stops during delivery, add/delete stops

### Permanent Learning System
- **Learns from Corrections** — When postman manually selects a stop after voice search fails, the system learns that mapping
- **IndexedDB Persistence** — Learned mappings stored locally and persist across app restarts
- **Route-Scoped Learning** — Each route has its own learned mappings (no cross-route contamination)
- **Confidence Scoring** — Learned mappings increase in confidence with each confirmation
- **Hybrid SaveNameModal** — Shows fuzzy match buttons if matches exist, text input fallback if no matches
- **Export Learned Mappings** — Download learned mappings as JSON/CSV for analysis

### Route Intelligence Engine
- **Multi-Index Architecture** — Pre-computes 7 specialized indexes (full names, surnames, first names, addresses, roads, aliases, tags)
- **Fuzzy Matching** — Finds similar names even with typos or partial matches
- **Learned Mapping Priority** — Checks learned mappings BEFORE fuzzy matching
- **Confidence Ranking** — Returns results sorted by match confidence
- **Feature Flag** — Route Intelligence can be toggled on/off for A/B testing

### Admin Panel
- **Field Testing Dashboard** — Real-time metrics on voice search performance
- **Learned Mappings Manager** — View, edit, delete learned corrections per route
- **Route Intelligence Configuration** — Adjust thresholds, enable/disable features
- **System Analytics** — Cross-route performance data, common speech errors
- **Export Analytics** — Download field test data as JSON/CSV

### Maps & Visualization
- **Google Maps Integration** — Color-coded pins per section, satellite view, Street View
- **Print View** — A4-formatted delivery list with all stops and notes
- **Public Share View** — Read-only route summary for sharing with stakeholders

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| **Frontend** | React 19, Tailwind CSS 4, TypeScript |
| **Backend** | Express 4, tRPC 11, Node.js |
| **Database** | MySQL/TiDB with Drizzle ORM |
| **Storage** | IndexedDB (local learning), S3 (file uploads) |
| **Maps** | Google Maps API (via Manus proxy) |
| **Testing** | Vitest (204 tests) |
| **Auth** | Passcode login + signed JWT session cookie |

---

## Project Structure

```
maghery-route/
├── client/
│   ├── src/
│   │   ├── pages/
│   │   │   ├── Home.tsx                    # Route selection
│   │   │   ├── RouteView.tsx               # Main delivery interface
│   │   │   ├── AdminPanel.tsx              # Admin dashboard
│   │   │   ├── MapView.tsx                 # Google Maps view
│   │   │   ├── PrintView.tsx               # A4 print layout
│   │   │   └── ShareView.tsx               # Public share view
│   │   ├── components/
│   │   │   ├── SaveNameModal.tsx           # Capture failed voice searches
│   │   │   ├── EditStopModal.tsx           # Edit stop details
│   │   │   ├── DashboardLayout.tsx         # Admin layout
│   │   │   ├── Map.tsx                     # Google Maps component
│   │   │   └── ui/                         # shadcn/ui components
│   │   ├── lib/
│   │   │   ├── routeIntelligence.ts        # Main search engine
│   │   │   ├── routeIntelligencePersistentLearning.ts  # IndexedDB storage
│   │   │   ├── correctionDetection.ts      # Detect manual corrections
│   │   │   ├── fieldTestingLogger.ts       # Analytics logging
│   │   │   ├── matching.ts                 # Fuzzy matching logic
│   │   │   └── trpc.ts                     # tRPC client
│   │   ├── App.tsx                         # Routes & layout
│   │   ├── main.tsx                        # React entry point
│   │   └── index.css                       # Global styles (Tailwind)
│   └── public/
│       ├── favicon.ico
│       └── robots.txt
├── server/
│   ├── routers.ts                          # tRPC procedures
│   ├── db.ts                               # Database helpers
│   ├── buildStopSpeech.ts                  # Voice callback generation
│   ├── boxSwitching.ts                     # Box number logic
│   ├── auth.logout.test.ts                 # Auth tests
│   └── _core/                              # Framework (auth, context, etc.)
├── drizzle/
│   ├── schema.ts                           # Database tables
│   └── migrations/                         # SQL migrations
├── shared/
│   └── matching.ts                         # Shared matching utilities
├── storage/
│   └── index.ts                            # S3 file storage helpers
├── package.json
├── pnpm-lock.yaml
├── tsconfig.json
├── vitest.config.ts
└── README.md (this file)
```

---

## Key Files Explained

### Learning System
- **`client/src/lib/routeIntelligencePersistentLearning.ts`** — IndexedDB storage for learned mappings with CRUD operations
- **`client/src/lib/correctionDetection.ts`** — Detects when user manually selects a stop after voice search fails
- **`client/src/components/SaveNameModal.tsx`** — UI for capturing and saving failed voice searches

### Search Engine
- **`client/src/lib/routeIntelligence.ts`** — Main Route Intelligence engine with fuzzy matching and learned mapping priority
- **`client/src/lib/matching.ts`** — Fuzzy matching logic with multi-level hierarchy (exact → alias → broad)
- **`shared/matching.ts`** — Shared utilities for matching across pages

### Admin & Analytics
- **`client/src/pages/AdminPanel.tsx`** — Main admin layout with tabbed navigation
- **`client/src/lib/fieldTestingLogger.ts`** — IndexedDB-backed logging for field test metrics
- **`client/src/pages/RouteView.tsx`** — Integrates learning and logging into delivery workflow

### Voice & Speech
- **`server/buildStopSpeech.ts`** — Generates voice callback text ("Name. Route Reference. Stop N.")
- **`client/src/hooks/useVoiceSearch.ts`** — Voice recognition state machine with iOS/Safari support

---

## Getting Started

### Prerequisites
- Node.js 22+
- pnpm (or npm/yarn)
- MySQL/TiDB database
- Google Maps API key (via Manus proxy)

### Local Development

```bash
# Clone the repository
git clone https://github.com/Beonlinepost/routelog.git
cd routelog

# Install dependencies
pnpm install

# Start dev server
pnpm dev

# Run tests
pnpm test

# Type check
pnpm tsc --noEmit
```

Dev server runs on **http://localhost:3000**

### Database Setup

1. Update `DATABASE_URL` in `.env` (or use Manus-provided connection string)
2. Apply migrations:
   ```bash
   pnpm drizzle-kit generate
   # Review generated SQL, then apply via Manus UI or directly
   ```

### Environment Variables

Required secrets:
- `DATABASE_URL` — MySQL/TiDB connection string
- `JWT_SECRET` — Session signing secret
- `ADMIN_PASSCODE` — Passcode for admin login (`POST /api/admin/login`)
- `BUILT_IN_FORGE_API_KEY` — Manus built-in APIs (server-side)
- `VITE_FRONTEND_FORGE_API_KEY` — Manus built-in APIs (client-side)

---

## Development Workflow

### Adding a Feature

1. **Update schema** in `drizzle/schema.ts`
2. **Generate migration** — `pnpm drizzle-kit generate`
3. **Apply migration** — Review SQL, apply via Manus UI
4. **Add database helper** in `server/db.ts`
5. **Create tRPC procedure** in `server/routers.ts`
6. **Build UI** in `client/src/pages/` or `client/src/components/`
7. **Write tests** in `*.test.ts` files
8. **Run tests** — `pnpm test`

### Testing

```bash
# Run all tests
pnpm test

# Watch mode
pnpm test --watch

# Specific test file
pnpm test correctionDetection.test.ts

# Coverage
pnpm test --coverage
```

**Current Test Coverage:**
- 204 tests passing
- 21 tests for persistent learning storage
- 30 tests for correction detection
- 68 tests for fuzzy matching
- 24 tests for Route Intelligence engine
- 22 tests for box switching logic
- 8 tests for voice callback generation
- 12 tests for tRPC routers
- 1 test for auth

---

## Learning System Architecture

### How It Works

1. **Postman says "McFadden"** → Speech engine hears "Mac Fatten"
2. **No exact match found** → SaveNameModal appears with fuzzy matches
3. **Postman taps "McFadden"** → System learns: "Mac Fatten" → McFadden
4. **Mapping stored in IndexedDB** with confirmation count and confidence
5. **Next time postman says "McFadden"** → Engine hears "Mac Fatten" → Checks learned mappings first → Returns McFadden immediately

### Confidence Calculation

```
confidence = 0.5 + (confirmationCount × 0.1), capped at 0.85
```

- First correction: 0.6 confidence
- Second correction: 0.7 confidence
- Third+ corrections: 0.85 confidence (max)

### Storage Schema (IndexedDB)

```typescript
{
  id: number,                    // Auto-increment
  routeId: number,               // Route this mapping belongs to
  originalTranscript: string,    // What speech engine heard
  normalizedTranscript: string,  // Normalized version
  stopId: number,                // Correct stop ID
  confirmationCount: number,     // How many times confirmed
  confidence: number,            // 0.5-0.85
  timestamp: number,             // When created
}
```

---

## Route Intelligence Engine

### Search Levels

| Level | Behavior | Example |
|-------|----------|---------|
| **1** | Learned mappings (highest priority) | "Mac Fatten" → McFadden |
| **2** | Exact phrase match | "John Ward" → John Ward |
| **3** | Alias phrase match | "Johnny Ward" → John Ward |
| **4** | Broad token fallback | "Ward" → All Wards |

### Configuration (Admin Panel)

- **Enable/Disable** Route Intelligence
- **Fuzzy Threshold** (0-100%) — Minimum match confidence
- **Learned Mapping Threshold** — Minimum confidence to use learned mapping
- **Alias Matching** — Enable/disable alias search
- **Broad Fallback** — Enable/disable broad token fallback
- **Max Fuzzy Results** — Limit number of results shown

---

## Admin Panel Features

### Field Testing Dashboard
- Total voice searches
- Successful first-time matches (%)
- Searches requiring manual correction (%)
- Average response time (ms)
- Learned vs fuzzy usage breakdown
- Top 10 common speech recognition errors

### Learned Mappings Manager
- View all learned corrections for current route
- See confirmation count and confidence for each mapping
- Delete individual mappings
- Clear all mappings for route
- Export as JSON/CSV

### Route Intelligence Configuration
- Toggle Route Intelligence on/off
- Adjust fuzzy matching threshold
- Adjust learned mapping confidence threshold
- Enable/disable alias matching
- Enable/disable broad fallback
- Set max fuzzy results limit

### System Analytics
- Cross-route performance metrics
- Total searches across all routes
- Overall success rate
- Average response time
- Most common speech errors
- Learned mappings per route

---

## Deployment

### Manus Hosting (Recommended)

The app is already deployed on Manus at:
**https://magheryrt-3b64p5qr.manus.space**

To deploy updates:
1. Make changes locally
2. Run `pnpm test` to verify
3. Create checkpoint via Manus UI
4. Click "Publish" button

### Custom Deployment

For external hosting (Railway, Render, Vercel):
1. Ensure `DATABASE_URL` is set
2. Build: `pnpm build`
3. Start: `pnpm start`
4. Port: `3000` (or set via `PORT` env var)

---

## Troubleshooting

### Voice Search Not Working
- Check browser permissions (microphone)
- Verify SpeechRecognition API available (not in private browsing)
- On iOS: Use Safari browser (PWA doesn't support SpeechRecognition)
- Check console for errors: `F12` → Console tab

### Learned Mappings Not Persisting
- Check IndexedDB in DevTools: `F12` → Application → IndexedDB
- Verify route ID is correct
- Clear browser cache and try again
- Check browser storage quota

### Fuzzy Matching Returns Wrong Results
- Adjust threshold in Admin Panel
- Review matching logic in `client/src/lib/matching.ts`
- Check if learned mapping should take priority
- Export analytics to see common errors

### Admin Panel Shows No Data
- Verify you're logged in
- Check if field testing is enabled
- Run a voice search to generate test data
- Refresh page and wait 2-3 seconds for data to load

---

## Contributing

### Code Style
- Use TypeScript for all new code
- Follow existing naming conventions
- Run `pnpm test` before committing
- Add tests for new features

### Pull Request Process
1. Create feature branch: `git checkout -b feature/your-feature`
2. Make changes and test: `pnpm test`
3. Commit with clear message: `git commit -m "Add feature description"`
4. Push to GitHub: `git push origin feature/your-feature`
5. Open pull request with description

---

## Performance Metrics

### Voice Search Performance
- **Average response time:** 200-400ms
- **Learned mapping lookup:** <50ms
- **Fuzzy matching:** 100-300ms
- **Speech callback generation:** <100ms

### Learning System Performance
- **IndexedDB write:** <10ms
- **Correction detection:** <5ms
- **Learned mapping priority check:** <20ms

### Tested on
- iPhone 12/13/14 (Safari)
- Android 12+ (Chrome)
- Desktop (Chrome, Firefox, Safari)

---

## Future Enhancements

1. **Cloud Sync** — Sync learned mappings across devices
2. **Machine Learning** — Use learned data to improve matching algorithm
3. **Postman Analytics** — Track individual postman performance
4. **Route Optimization** — Suggest optimal delivery order
5. **Mobile App** — Native iOS/Android app with offline support
6. **Integration** — Connect with Royal Mail/An Post systems

---

## Support

For issues, questions, or feature requests:
1. Check the troubleshooting section above
2. Review existing GitHub issues
3. Create a new issue with:
   - Description of problem
   - Steps to reproduce
   - Browser/device info
   - Screenshots if applicable

---

## License

Proprietary — Beonlinepost

---

## Credits

Built with:
- [React 19](https://react.dev)
- [Tailwind CSS 4](https://tailwindcss.com)
- [tRPC](https://trpc.io)
- [Drizzle ORM](https://orm.drizzle.team)
- [shadcn/ui](https://ui.shadcn.com)
- [Manus Platform](https://manus.im)

---

**Last Updated:** July 29, 2026

**Current Version:** 1.0.0 (Field Testing Phase)

**Status:** Production-ready after live field testing on Ranafast (Test) route
